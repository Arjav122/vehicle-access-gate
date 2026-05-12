import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_admin
from app.models import Admin
from app.schemas.visitor import (
    VisitorApproval,
    VisitorCreate,
    VisitorGateRequest,
    VisitorPublic,
)
from app.services import visitor_service
from app.agents.visitor_graph import run_visitor_agent

router = APIRouter(tags=["admin"])


@router.get("/visitors/pending-approval", response_model=list[VisitorPublic])
def list_pending_gate_visitors(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> list[VisitorPublic]:
    return visitor_service.list_pending_gate_visitors(db)


@router.post("/visitors/gate-request", response_model=VisitorPublic, status_code=status.HTTP_201_CREATED)
def create_gate_visitor_request(
    body: VisitorGateRequest,
    db: Annotated[Session, Depends(get_db)],
) -> VisitorPublic:
    return visitor_service.create_gate_visitor_request(db, body)


@router.patch("/visitors/{visitor_id}/approval", response_model=VisitorPublic)
def approve_or_reject_visitor(
    visitor_id: uuid.UUID,
    body: VisitorApproval,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> VisitorPublic:
    out = visitor_service.set_visitor_approval(db, visitor_id, body)
    if not out:
        raise HTTPException(status_code=404, detail="Visitor not found or not pending approval")
    return out


@router.get("/visitors", response_model=list[VisitorPublic])
def list_visitors(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
    active_only: bool = False,
    active_pass_not_expired: bool = False,
) -> list[VisitorPublic]:
    return visitor_service.list_visitors(
        db,
        active_only=active_only,
        active_pass_not_expired=active_pass_not_expired,
    )


@router.post("/visitors", response_model=VisitorPublic, status_code=status.HTTP_201_CREATED)
def create_visitor(
    body: VisitorCreate,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> VisitorPublic:
    return VisitorPublic.model_validate(run_visitor_agent(db, body.model_dump(mode="json")))


@router.delete("/visitors/{visitor_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_visitor(
    visitor_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> None:
    if not visitor_service.delete_visitor(db, visitor_id):
        raise HTTPException(status_code=404, detail="Visitor not found")
