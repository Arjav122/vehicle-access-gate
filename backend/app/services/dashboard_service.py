from sqlalchemy import func, select
from sqlalchemy.orm import Session
import uuid

from app.models import AccessLog, Alert, Visitor, VisitorStatus
from app.schemas.access import AccessLogListItem
from app.schemas.dashboard import AccessLogPublic, DashboardSummary
from app.utils.timezone import now_in_app_tz


def build_dashboard(db: Session) -> DashboardSummary:
    tz_now = now_in_app_tz()
    day_start = tz_now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = tz_now.replace(hour=23, minute=59, second=59, microsecond=999999)

    entries_today = db.scalar(
        select(func.count())
        .select_from(AccessLog)
        .where(
            AccessLog.access_result == "AUTHORIZED",
            AccessLog.created_at >= day_start,
            AccessLog.created_at <= day_end,
        )
    ) or 0

    exits_today = db.scalar(
        select(func.count())
        .select_from(AccessLog)
        .where(
            AccessLog.access_result == "UNAUTHORIZED",
            AccessLog.created_at >= day_start,
            AccessLog.created_at <= day_end,
        )
    ) or 0

    vehicles_inside = 0

    active_visitors = db.scalar(
        select(func.count())
        .select_from(Visitor)
        .where(Visitor.status == VisitorStatus.VALID)
    ) or 0

    open_alerts = db.scalar(
        select(func.count()).select_from(Alert).where(Alert.resolved.is_(False))
    ) or 0

    recent = (
        db.execute(
            select(AccessLog).order_by(AccessLog.created_at.desc()).limit(12)
        )
        .scalars()
        .all()
    )
    recent_logs = [
        AccessLogPublic(
            id=r.id,
            plate_normalized=r.plate_normalized,
            event_type=r.access_result,
            authorized=r.access_result == "AUTHORIZED",
            created_at=r.created_at,
            notes=r.access_result,
        )
        for r in recent
    ]

    return DashboardSummary(
        entries_today=int(entries_today),
        exits_today=int(exits_today),
        vehicles_inside=int(vehicles_inside),
        active_visitors=int(active_visitors),
        open_alerts=int(open_alerts),
        recent_logs=recent_logs,
    )


def list_access_logs(
    db: Session,
    *,
    skip: int = 0,
    limit: int = 50,
    plate: str | None = None,
    event_type: str | None = None,
) -> list[AccessLogListItem]:
    q = select(AccessLog).order_by(AccessLog.created_at.desc())
    if plate:
        norm = plate.replace(" ", "").upper()
        q = q.where(AccessLog.plate_normalized.ilike(f"%{norm}%"))
    rows = db.execute(q.offset(skip).limit(limit)).scalars().all()
    return [
        AccessLogListItem(
            id=r.id,
            plate_normalized=r.plate_normalized,
            user_type=r.user_type,
            user_name=r.user_name,
            access_result=r.access_result,
            created_at=r.created_at,
            visitor_id=r.visitor_id,
        )
        for r in rows
    ]


def delete_access_log(db: Session, log_id: uuid.UUID) -> bool:
    row = db.scalar(select(AccessLog).where(AccessLog.id == log_id))
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True
