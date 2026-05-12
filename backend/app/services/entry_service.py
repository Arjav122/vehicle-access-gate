import uuid
from datetime import timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AccessLog, Alert, AlertSeverity, Resident, Visitor, VisitorStatus
from app.schemas.access import AccessProcessResult
from app.services.alert_service import create_alert
from app.utils.plates import normalize_plate
from app.utils.timezone import now_in_app_tz


def _plate_candidates(plate_norm: str) -> list[str]:
    """Generate small OCR-tolerant variants (O/0, I/1, S/5)."""
    variants = {plate_norm}
    swaps = (("O", "0"), ("I", "1"), ("S", "5"))
    for a, b in swaps:
        variants.update({v.replace(a, b) for v in list(variants)})
        variants.update({v.replace(b, a) for v in list(variants)})
    return list(variants)


def _within_one_edit(a: str, b: str) -> bool:
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    # One substitution
    if la == lb:
        return sum(1 for x, y in zip(a, b) if x != y) <= 1
    # One insertion/deletion
    if la > lb:
        a, b = b, a
        la, lb = lb, la
    i = j = edits = 0
    while i < la and j < lb:
        if a[i] == b[j]:
            i += 1
            j += 1
        else:
            edits += 1
            j += 1
            if edits > 1:
                return False
    return True


def _active_visitor_for_plate(db: Session, plate_norm: str) -> Visitor | None:
    candidates = _plate_candidates(plate_norm)
    return db.scalar(
        select(Visitor).where(
            Visitor.plate_raw.in_(candidates),
            Visitor.status == VisitorStatus.VALID,
        )
    )


def _entered_visitor_for_plate(db: Session, plate_norm: str) -> Visitor | None:
    candidates = _plate_candidates(plate_norm)
    return db.scalar(
        select(Visitor).where(
            Visitor.plate_raw.in_(candidates),
            Visitor.status.in_([VisitorStatus.ENTERED, VisitorStatus.OVERSTAYED]),
        )
    )


def _pending_visitor_for_plate(db: Session, plate_norm: str) -> Visitor | None:
    candidates = _plate_candidates(plate_norm)
    return db.scalar(
        select(Visitor).where(
            Visitor.plate_raw.in_(candidates),
            Visitor.status == VisitorStatus.PENDING,
        )
    )


def _resident_for_plate(db: Session, plate_norm: str) -> Resident | None:
    # Strict match only for residents to avoid false authorization
    # (e.g. RJ14CV0001 must not match RJ14CV0002 or RJ14CV0012).
    return db.scalar(
        select(Resident).where(
            Resident.vehicle_plate_number == plate_norm,
        )
    )


def _expired_visitor_for_plate(db: Session, plate_norm: str) -> Visitor | None:
    candidates = _plate_candidates(plate_norm)
    return db.scalar(
        select(Visitor).where(
            Visitor.plate_raw.in_(candidates),
            Visitor.status.in_(
                [
                    VisitorStatus.EXPIRED,
                    VisitorStatus.OVERSTAYED,
                    VisitorStatus.REJECTED,
                ]
            ),
        )
    )


def process_plate_access(db: Session, plate_raw: str) -> AccessProcessResult:
    plate_norm = normalize_plate(plate_raw)
    if not plate_norm:
        return AccessProcessResult(
            authorized=False,
            action="unauthorized",
            message="Invalid plate text",
            requires_visitor_registration=False,
        )

    resident = _resident_for_plate(db, plate_norm)
    if resident:
        return _process_resident_access(db, resident, plate_norm)

    visitor = _active_visitor_for_plate(db, plate_norm)
    if visitor:
        return _process_visitor_entry(db, visitor, plate_norm)

    entered_visitor = _entered_visitor_for_plate(db, plate_norm)
    if entered_visitor:
        return _process_visitor_exit(db, entered_visitor, plate_norm)

    pending = _pending_visitor_for_plate(db, plate_norm)
    if pending:
        return AccessProcessResult(
            authorized=False,
            action="unauthorized",
            message="Visitor pass request is pending admin approval.",
            requires_visitor_registration=False,
        )

    expired = _expired_visitor_for_plate(db, plate_norm)
    if expired:
        log = AccessLog(
            id=uuid.uuid4(),
            plate_normalized=plate_norm,
            user_type="VISITOR",
            user_name=expired.name,
            access_result="UNAUTHORIZED",
            visitor_id=expired.id,
        )
        db.add(log)
        db.commit()
        return AccessProcessResult(
            authorized=False,
            action="visitor_request",
            message="Existing visitor pass is no longer valid. Apply a new gate pass.",
            requires_visitor_registration=True,
        )

    return AccessProcessResult(
        authorized=False,
        action="visitor_request",
        message="Unknown plate — register visitor",
        requires_visitor_registration=True,
    )


def _process_resident_access(
    db: Session, resident: Resident, plate_norm: str
) -> AccessProcessResult:
    log = AccessLog(
        id=uuid.uuid4(),
        plate_normalized=plate_norm,
        user_type="RESIDENT",
        user_name=resident.name,
        access_result="AUTHORIZED",
        visitor_id=None,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return AccessProcessResult(
        authorized=True,
        action="authorized",
        message="Resident authorized",
        log_id=log.id,
        resident_name=resident.name,
        unit_number=None,
        vehicle_type="Resident vehicle",
    )


def _process_visitor_entry(
    db: Session, visitor: Visitor, plate_norm: str
) -> AccessProcessResult:
    now = now_in_app_tz()
    visitor.status = VisitorStatus.ENTERED
    visitor.entered_at = now
    visitor.exited_at = None
    visitor.valid_until = now + timedelta(minutes=visitor.expected_duration_minutes)
    log = AccessLog(
        id=uuid.uuid4(),
        plate_normalized=plate_norm,
        user_type="VISITOR",
        user_name=visitor.name,
        access_result="ENTRY",
        visitor_id=visitor.id,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return AccessProcessResult(
        authorized=True,
        action="authorized",
        message="Visitor entry granted",
        resident_name=visitor.name,
        log_id=log.id,
    )


def _process_visitor_exit(
    db: Session, visitor: Visitor, plate_norm: str
) -> AccessProcessResult:
    now = now_in_app_tz()
    is_overstayed = bool(
        visitor.entered_at
        and now > (visitor.entered_at + timedelta(minutes=visitor.expected_duration_minutes))
    )
    if is_overstayed:
        visitor.status = VisitorStatus.OVERSTAYED
        existing_alert = db.scalar(
            select(Alert).where(
                Alert.visitor_id == visitor.id,
                Alert.alert_type == "visitor_overstay",
            )
        )
        if not existing_alert:
            create_alert(
                db,
                alert_type="visitor_overstay",
                title="Visitor overstayed",
                message=f"{visitor.name} ({plate_norm}) exceeded allowed window.",
                severity=AlertSeverity.HIGH,
                plate_normalized=plate_norm,
                visitor_id=visitor.id,
                commit=False,
            )

    visitor.status = VisitorStatus.EXPIRED
    visitor.exited_at = now
    log = AccessLog(
        id=uuid.uuid4(),
        plate_normalized=plate_norm,
        user_type="VISITOR",
        user_name=visitor.name,
        access_result="EXIT_OVERSTAYED" if is_overstayed else "EXIT",
        visitor_id=visitor.id,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return AccessProcessResult(
        authorized=True,
        action="authorized",
        message=(
            "Visitor exit recorded after overstay. Alert generated and gate pass expired."
            if is_overstayed
            else "Visitor exit recorded. Gate pass expired."
        ),
        resident_name=visitor.name,
        log_id=log.id,
    )
