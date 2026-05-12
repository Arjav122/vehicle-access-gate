import uuid
from datetime import timedelta

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models import AccessLog, Visitor, VisitorStatus
from app.schemas.visitor import VisitorApproval, VisitorCreate, VisitorGateRequest, VisitorPublic
from app.utils.plates import normalize_plate
from app.utils.timezone import now_in_app_tz


def create_visitor_pass(db: Session, data: VisitorCreate) -> VisitorPublic:
    tz_now = now_in_app_tz()
    valid_until = tz_now + timedelta(minutes=data.expected_duration_minutes)
    plate_norm = normalize_plate(data.plate_raw)

    row = Visitor(
        id=uuid.uuid4(),
        name=data.name,
        phone=data.phone,
        purpose=data.purpose,
        plate_raw=plate_norm,
        expected_duration_minutes=data.expected_duration_minutes,
        valid_until=valid_until,
        status=VisitorStatus.VALID,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return VisitorPublic.model_validate(row)


def create_gate_visitor_request(db: Session, data: VisitorGateRequest) -> VisitorPublic:
    """Gate kiosk: pending admin approval + registration log."""
    tz_now = now_in_app_tz()
    plate_norm = normalize_plate(data.plate_raw)
    valid_until = tz_now + timedelta(minutes=data.expected_duration_minutes)

    row = Visitor(
        id=uuid.uuid4(),
        name=data.name.strip(),
        phone=data.phone.strip(),
        purpose=data.purpose.strip(),
        plate_raw=plate_norm,
        expected_duration_minutes=data.expected_duration_minutes,
        entered_at=None,
        exited_at=None,
        valid_until=valid_until,
        status=VisitorStatus.PENDING,
    )
    db.add(row)
    db.flush()

    log = AccessLog(
        id=uuid.uuid4(),
        plate_normalized=plate_norm,
        user_type="VISITOR",
        user_name=row.name,
        access_result="VISITOR_REQUEST",
        visitor_id=row.id,
    )
    db.add(log)
    db.commit()
    db.refresh(row)
    return VisitorPublic.model_validate(row)


def list_pending_gate_visitors(db: Session) -> list[VisitorPublic]:
    q = (
        select(Visitor)
        .where(Visitor.status == VisitorStatus.PENDING)
        .order_by(Visitor.created_at.desc())
    )
    rows = db.scalars(q.limit(200)).all()
    return [VisitorPublic.model_validate(r) for r in rows]


def set_visitor_approval(
    db: Session, visitor_id: uuid.UUID, body: VisitorApproval
) -> VisitorPublic | None:
    row = db.scalar(select(Visitor).where(Visitor.id == visitor_id))
    if not row or row.status != VisitorStatus.PENDING:
        return None
    now = now_in_app_tz()
    if body.approved:
        row.status = VisitorStatus.VALID
        row.entered_at = None
        row.exited_at = None
        row.valid_until = now + timedelta(minutes=row.expected_duration_minutes)
        db.add(
            AccessLog(
                id=uuid.uuid4(),
                plate_normalized=row.plate_raw,
                user_type="VISITOR",
                user_name=row.name,
                access_result="VISITOR_APPROVED",
                visitor_id=row.id,
            )
        )
    else:
        row.status = VisitorStatus.REJECTED
        db.add(
            AccessLog(
                id=uuid.uuid4(),
                plate_normalized=row.plate_raw,
                user_type="VISITOR",
                user_name=row.name,
                access_result="VISITOR_REJECTED",
                visitor_id=row.id,
            )
        )
    db.commit()
    db.refresh(row)
    return VisitorPublic.model_validate(row)


def list_visitors(
    db: Session,
    *,
    active_only: bool = False,
    active_pass_not_expired: bool = False,
) -> list[VisitorPublic]:
    """List visitors. Optional filters for admin UI."""
    q = select(Visitor).order_by(Visitor.created_at.desc())
    now = now_in_app_tz()
    if active_pass_not_expired:
        # Approved pass still within valid_until, or on-site after window (overstayed, not exited).
        q = q.where(
            or_(
                and_(
                    Visitor.status.in_([VisitorStatus.VALID, VisitorStatus.ENTERED]),
                    Visitor.valid_until >= now,
                ),
                and_(Visitor.status == VisitorStatus.OVERSTAYED, Visitor.exited_at.is_(None)),
            )
        )
    elif active_only:
        q = q.where(Visitor.status == VisitorStatus.VALID)
    rows = db.scalars(q.limit(200)).all()
    return [VisitorPublic.model_validate(r) for r in rows]


def delete_visitor(db: Session, visitor_id: uuid.UUID) -> bool:
    row = db.scalar(select(Visitor).where(Visitor.id == visitor_id))
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True
