from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_current_admin
from app.models import Admin
from app.schemas.setting import SettingPublic, SettingUpsert
from app.services import setting_service

router = APIRouter(tags=["admin"])


@router.get("/settings", response_model=list[SettingPublic])
def list_settings(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> list[SettingPublic]:
    return setting_service.list_settings(db)


@router.put("/settings", response_model=SettingPublic)
def upsert_setting(
    body: SettingUpsert,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Admin, Depends(get_current_admin)],
) -> SettingPublic:
    return setting_service.upsert_setting(db, body)
