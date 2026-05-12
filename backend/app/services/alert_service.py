import uuid
from datetime import timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Alert, AlertSeverity, Visitor, VisitorStatus
from app.schemas.alert import AlertPublic, AlertResolve
from app.utils.timezone import now_in_app_tz


def list_alerts(
    db: Session, *, resolved: bool | None = None, skip: int = 0, limit: int = 100
) -> list[AlertPublic]:
    q = select(Alert).order_by(Alert.created_at.desc())
    if resolved is not None:
        q = q.where(Alert.resolved.is_(resolved))
    rows = db.scalars(q.offset(skip).limit(limit)).all()
    return [AlertPublic.model_validate(r) for r in rows]


def resolve_alert(db: Session, alert_id: uuid.UUID, data: AlertResolve) -> AlertPublic | None:
    row = db.scalar(select(Alert).where(Alert.id == alert_id))
    if not row:
        return None
    row.resolved = data.resolved
    db.commit()
    db.refresh(row)
    return AlertPublic.model_validate(row)


def create_alert(
    db: Session,
    *,
    alert_type: str,
    title: str,
    message: str,
    severity: AlertSeverity = AlertSeverity.MEDIUM,
    plate_normalized: str | None = None,
    visitor_id: uuid.UUID | None = None,
    commit: bool = True,
) -> Alert:
    row = Alert(
        id=uuid.uuid4(),
        alert_type=alert_type,
        title=title,
        message=message,
        severity=severity,
        plate_normalized=plate_normalized,
        visitor_id=visitor_id,
        resolved=False,
    )
    db.add(row)
    if commit:
        db.commit()
        db.refresh(row)
    else:
        db.flush()
    return row


def run_visitor_overstay_checks(db: Session) -> list[uuid.UUID]:
    """Mark overstayed visitors and create alerts. Returns visitor ids that triggered alerts."""
    now = now_in_app_tz()
    rows = db.scalars(select(Visitor).where(Visitor.status == VisitorStatus.ENTERED)).all()
    alerted_ids: list[uuid.UUID] = []
    for v in rows:
        if not v.entered_at:
            continue
        cutoff = v.entered_at + timedelta(minutes=v.expected_duration_minutes)
        if now <= cutoff:
            continue
        v.status = VisitorStatus.OVERSTAYED
        create_alert(
            db,
            alert_type="visitor_overstay",
            title="Visitor overstayed",
            message=f"{v.name} ({v.plate_raw}) exceeded allowed window.",
            severity=AlertSeverity.HIGH,
            plate_normalized=v.plate_raw,
            visitor_id=v.id,
            commit=False,
        )
        alerted_ids.append(v.id)
    if alerted_ids:
        db.commit()
    return alerted_ids
