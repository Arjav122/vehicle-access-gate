import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_admin
from app.models import Admin
from app.schemas.resident import ResidentCreate, ResidentPublic, ResidentUpdate
from app.services import resident_service

router = APIRouter(tags=["admin"])


@router.get("/residents", response_model=list[ResidentPublic])
def list_residents(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
    skip: int = 0,
    limit: int = 100,
) -> list[ResidentPublic]:
    return resident_service.list_residents(db, skip=skip, limit=limit)


@router.post("/residents", response_model=ResidentPublic, status_code=status.HTTP_201_CREATED)
def create_resident(
    body: ResidentCreate,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> ResidentPublic:
    return resident_service.create_resident(db, body)


@router.patch("/residents/{resident_id}", response_model=ResidentPublic)
def update_resident(
    resident_id: uuid.UUID,
    body: ResidentUpdate,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> ResidentPublic:
    out = resident_service.update_resident(db, resident_id, body)
    if not out:
        raise HTTPException(status_code=404, detail="Resident not found")
    return out


@router.delete("/residents/{resident_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resident(
    resident_id: uuid.UUID,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> None:
    if not resident_service.delete_resident(db, resident_id):
        raise HTTPException(status_code=404, detail="Resident not found")
