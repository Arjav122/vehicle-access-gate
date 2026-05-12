import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_admin
from app.models import Admin
from app.models import AccessLog
from app.schemas.access import AccessProcessResult
from app.schemas.alert import AlertPublic, AlertResolve
from app.schemas.assistant import AssistantRequest, AssistantResponse
from app.schemas.dashboard import DashboardSummary
from app.schemas.detection import (
    PlateConsensusFrameResult,
    PlateConsensusResult,
    PlateDetectionResult,
    PlateProcessRequest,
)
from app.services import dashboard_service
from app.services.assistant_service import run_assistant
from app.services.alert_service import list_alerts, resolve_alert
from app.services.reports_service import weekly_traffic_summary
from app.services.vision_service import analyze_detection_scan, analyze_frames_consensus
from app.agents.alert_graph import run_alert_agent
from app.agents.analytics_graph import run_analytics_agent
from app.services.entry_service import process_plate_access

router = APIRouter(tags=["operations"])


@router.get("/dashboard/summary", response_model=DashboardSummary)
def dashboard_summary(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> DashboardSummary:
    return dashboard_service.build_dashboard(db)


@router.get("/logs/access")
def access_logs(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
    skip: int = 0,
    limit: int = 50,
    plate: str | None = None,
    event_type: str | None = None,
):
    return dashboard_service.list_access_logs(
        db, skip=skip, limit=limit, plate=plate, event_type=event_type
    )


@router.delete("/logs/access/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_access_log(
    log_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> None:
    if not dashboard_service.delete_access_log(db, log_id):
        raise HTTPException(status_code=404, detail="Access log not found")


@router.get("/alerts", response_model=list[AlertPublic])
def alerts_list(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
    resolved: bool | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[AlertPublic]:
    return list_alerts(db, resolved=resolved, skip=skip, limit=limit)


@router.patch("/alerts/{alert_id}", response_model=AlertPublic)
def alerts_resolve(
    alert_id: uuid.UUID,
    body: AlertResolve,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> AlertPublic:
    out = resolve_alert(db, alert_id, body)
    if not out:
        raise HTTPException(status_code=404, detail="Alert not found")
    return out


@router.post("/access/process", response_model=AccessProcessResult)
def access_process(
    body: PlateProcessRequest,
    db: Annotated[Session, Depends(get_db)],
) -> AccessProcessResult:
    """Authorize plate against DB (residents + visitors). Direct service call — no graph wrapper."""
    return process_plate_access(db, body.plate_text)


@router.post("/detection/analyze", response_model=PlateDetectionResult)
async def detection_analyze(
    file: Annotated[list[UploadFile], File()],
):
    raw_list = [await u.read() for u in file[:3]]
    if not raw_list or all(len(x) == 0 for x in raw_list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No image data: upload one or more JPEG frames as form field 'file'.",
        )
    r = analyze_detection_scan(raw_list)
    return PlateDetectionResult(
        plate_text=r.plate_text,
        confidence=r.confidence,
        detection_confidence=r.detection_confidence,
        plate_boxes_found=r.plate_boxes_found,
        detail=r.detail,
        candidates=r.candidates,
        ocr_preprocessing=r.ocr_preprocessing,
        recommend_rescan=r.recommend_rescan,
    )


@router.post("/detection/analyze-consensus", response_model=PlateConsensusResult)
async def detection_analyze_consensus(
    files: list[UploadFile] = File(...),
    min_confidence: float = Query(default=0.55, ge=0.0, le=1.0),
):
    raw_frames = [await f.read() for f in files[:5]]
    result = analyze_frames_consensus(raw_frames, min_confidence=min_confidence)
    return PlateConsensusResult(
        plate_text=result.plate_text,
        confidence=result.confidence,
        reliable=result.reliable,
        recommend_rescan=result.recommend_rescan,
        detail=result.detail,
        candidates=result.candidates,
        frames_used=result.frames_used,
        detections_found=result.detections_found,
        frame_results=[
            PlateConsensusFrameResult(
                plate_text=r.plate_text,
                confidence=r.confidence,
                detection_confidence=r.detection_confidence,
                plate_boxes_found=r.plate_boxes_found,
            )
            for r in result.frame_results
        ],
    )


@router.get("/gate/recent-logs")
def gate_recent_logs(
    db: Annotated[Session, Depends(get_db)],
    limit: int = 12,
):
    rows = db.scalars(
        select(AccessLog).order_by(AccessLog.created_at.desc()).limit(max(1, min(limit, 50)))
    ).all()
    out = []
    for row in rows:
        out.append(
            {
                "log_id": str(row.id),
                "vehicle_plate_number": row.plate_normalized,
                "user_type": row.user_type,
                "user_name": row.user_name,
                "access_result": row.access_result,
                "timestamp": row.created_at,
            }
        )
    return out


@router.get("/reports/weekly-traffic")
def reports_weekly(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
):
    return weekly_traffic_summary(db)


@router.post("/assistant/query", response_model=AssistantResponse)
def assistant_query(
    body: AssistantRequest,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> AssistantResponse:
    reply = run_assistant(db, body.message)
    return AssistantResponse(reply=reply)


@router.post("/agents/alert/run")
def agent_alert_run(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
):
    return {"triggered_visitor_ids": run_alert_agent(db)}


@router.get("/agents/analytics/snapshot")
def agent_analytics_snapshot(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
):
    return run_analytics_agent(db)
