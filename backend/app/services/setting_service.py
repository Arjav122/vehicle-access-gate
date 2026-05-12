import uuid
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Setting
from app.schemas.setting import SettingPublic, SettingUpsert


def upsert_setting(db: Session, data: SettingUpsert) -> SettingPublic:
    row = db.scalar(select(Setting).where(Setting.key == data.key))
    if row:
        row.value = data.value
    else:
        row = Setting(id=uuid.uuid4(), key=data.key, value=data.value)
        db.add(row)
    db.commit()
    db.refresh(row)
    return SettingPublic.model_validate(row)


def list_settings(db: Session) -> list[SettingPublic]:
    rows = db.scalars(select(Setting).order_by(Setting.key)).all()
    return [SettingPublic.model_validate(r) for r in rows]


def get_setting_value(db: Session, key: str, default: str | None = None) -> str | None:
    row = db.scalar(select(Setting).where(Setting.key == key))
    if not row:
        return default
    return row.value
