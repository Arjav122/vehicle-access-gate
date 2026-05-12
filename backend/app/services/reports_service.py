from datetime import timedelta
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AccessLog, Visitor, VisitorStatus
from app.utils.timezone import now_in_app_tz


def weekly_traffic_summary(db: Session) -> dict:
    now = now_in_app_tz()
    start = now - timedelta(days=7)
    entries = db.scalar(
        select(func.count())
        .select_from(AccessLog)
        .where(
            AccessLog.access_result == "AUTHORIZED",
            AccessLog.created_at >= start,
        )
    ) or 0
    exits = db.scalar(
        select(func.count())
        .select_from(AccessLog)
        .where(
            AccessLog.access_result != "AUTHORIZED",
            AccessLog.created_at >= start,
        )
    ) or 0
    return {"period_days": 7, "entries": int(entries), "exits": int(exits)}


def overstayed_visitors_summary(db: Session) -> list[dict]:
    now = now_in_app_tz()
    rows = db.scalars(
        select(Visitor).where(
            Visitor.status == VisitorStatus.VALID,
            Visitor.valid_until < now,
        )
    ).all()
    return [
        {
            "id": str(v.id),
            "name": v.name,
            "phone": v.phone,
            "plate": v.plate_raw,
            "valid_until": v.valid_until.isoformat(),
        }
        for v in rows
    ]
