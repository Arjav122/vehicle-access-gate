from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SettingUpsert(BaseModel):
    key: str = Field(min_length=1, max_length=128)
    value: str


class SettingPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    key: str
    value: str
    updated_at: datetime
