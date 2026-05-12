import uuid
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Resident
from app.schemas.resident import ResidentCreate, ResidentPublic, ResidentUpdate
from app.utils.plates import normalize_plate


def create_resident(db: Session, data: ResidentCreate) -> ResidentPublic:
    payload = data.model_dump()
    plate = payload.get("vehicle_plate_number")
    payload["vehicle_plate_number"] = normalize_plate(plate) if plate else None
    row = Resident(id=uuid.uuid4(), **payload)
    db.add(row)
    db.commit()
    db.refresh(row)
    return ResidentPublic.model_validate(row)


def list_residents(db: Session, *, skip: int = 0, limit: int = 100) -> list[ResidentPublic]:
    rows = db.scalars(select(Resident).order_by(Resident.created_at.desc()).offset(skip).limit(limit)).all()
    return [ResidentPublic.model_validate(r) for r in rows]


def get_resident(db: Session, resident_id: uuid.UUID) -> Resident | None:
    return db.scalar(select(Resident).where(Resident.id == resident_id))


def update_resident(db: Session, resident_id: uuid.UUID, data: ResidentUpdate) -> ResidentPublic | None:
    row = get_resident(db, resident_id)
    if not row:
        return None
    for k, v in data.model_dump(exclude_unset=True).items():
        if k == "vehicle_plate_number" and v is not None:
            v = normalize_plate(v)
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return ResidentPublic.model_validate(row)


def delete_resident(db: Session, resident_id: uuid.UUID) -> bool:
    row = get_resident(db, resident_id)
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True
