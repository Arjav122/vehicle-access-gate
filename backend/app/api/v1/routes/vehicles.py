import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_admin
from app.models import Admin
from app.schemas.vehicle import VehicleCreate, VehiclePublic, VehicleUpdate
from app.services import vehicle_service

router = APIRouter(tags=["admin"])


@router.get("/vehicles", response_model=list[VehiclePublic])
def list_vehicles(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
    skip: int = 0,
    limit: int = 200,
) -> list[VehiclePublic]:
    return vehicle_service.list_vehicles(db, skip=skip, limit=limit)


@router.post("/vehicles", response_model=VehiclePublic, status_code=status.HTTP_201_CREATED)
def create_vehicle(
    body: VehicleCreate,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> VehiclePublic:
    try:
        return vehicle_service.create_vehicle(db, body)
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Plate already registered") from exc


@router.patch("/vehicles/{vehicle_id}", response_model=VehiclePublic)
def update_vehicle(
    vehicle_id: uuid.UUID,
    body: VehicleUpdate,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> VehiclePublic:
    out = vehicle_service.update_vehicle(db, vehicle_id, body)
    if not out:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return out


@router.delete("/vehicles/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle(
    vehicle_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> None:
    if not vehicle_service.delete_vehicle(db, vehicle_id):
        raise HTTPException(status_code=404, detail="Vehicle not found")
