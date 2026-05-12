from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ResidentBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=32)
    vehicle_plate_number: str | None = Field(default=None, max_length=32)


class ResidentCreate(ResidentBase):
    pass


class ResidentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    phone: str | None = None
    vehicle_plate_number: str | None = None


class ResidentPublic(ResidentBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
