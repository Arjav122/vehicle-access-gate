import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import Vehicle
from app.schemas.vehicle import VehicleCreate, VehiclePublic, VehicleUpdate
from app.utils.plates import normalize_plate


def create_vehicle(db: Session, data: VehicleCreate) -> VehiclePublic:
    norm = normalize_plate(data.plate_raw)
    row = Vehicle(
        id=uuid.uuid4(),
        resident_id=data.resident_id,
        plate_raw=data.plate_raw.strip(),
        plate_normalized=norm,
        make=data.make,
        model=data.model,
        color=data.color,
        vehicle_type=data.vehicle_type,
        is_active=data.is_active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return VehiclePublic.model_validate(row)


def list_vehicles(db: Session, *, skip: int = 0, limit: int = 200) -> list[VehiclePublic]:
    rows = db.scalars(
        select(Vehicle).order_by(Vehicle.created_at.desc()).offset(skip).limit(limit)
    ).all()
    return [VehiclePublic.model_validate(r) for r in rows]


def get_vehicle(db: Session, vehicle_id: uuid.UUID) -> Vehicle | None:
    return db.scalar(select(Vehicle).where(Vehicle.id == vehicle_id))


def get_vehicle_by_plate(db: Session, plate_normalized: str) -> Vehicle | None:
    return db.scalar(
        select(Vehicle)
        .options(joinedload(Vehicle.resident))
        .where(
            Vehicle.plate_normalized == plate_normalized,
            Vehicle.is_active.is_(True),
        )
    )


def update_vehicle(db: Session, vehicle_id: uuid.UUID, data: VehicleUpdate) -> VehiclePublic | None:
    row = get_vehicle(db, vehicle_id)
    if not row:
        return None
    payload = data.model_dump(exclude_unset=True)
    if "plate_raw" in payload and payload["plate_raw"]:
        payload["plate_normalized"] = normalize_plate(payload["plate_raw"])
    for k, v in payload.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return VehiclePublic.model_validate(row)


def delete_vehicle(db: Session, vehicle_id: uuid.UUID) -> bool:
    row = get_vehicle(db, vehicle_id)
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True
