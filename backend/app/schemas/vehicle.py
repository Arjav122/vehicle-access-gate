from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class VehicleBase(BaseModel):
    plate_raw: str = Field(min_length=1, max_length=32)
    resident_id: UUID | None = None
    make: str | None = Field(default=None, max_length=64)
    model: str | None = Field(default=None, max_length=64)
    color: str | None = Field(default=None, max_length=32)
    vehicle_type: str | None = Field(default=None, max_length=64)
    is_active: bool = True


class VehicleCreate(VehicleBase):
    pass


class VehicleUpdate(BaseModel):
    plate_raw: str | None = Field(default=None, min_length=1, max_length=32)
    resident_id: UUID | None = None
    make: str | None = None
    model: str | None = None
    color: str | None = None
    vehicle_type: str | None = None
    is_active: bool | None = None


class VehiclePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    resident_id: UUID | None
    plate_raw: str
    plate_normalized: str
    make: str | None
    model: str | None
    color: str | None
    vehicle_type: str | None
    is_active: bool
    is_inside: bool
    last_entry_at: datetime | None
    last_exit_at: datetime | None
    created_at: datetime
    updated_at: datetime
