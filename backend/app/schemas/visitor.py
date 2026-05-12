from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class VisitorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    phone: str = Field(min_length=5, max_length=32)
    purpose: str = Field(min_length=1, max_length=512)
    plate_raw: str = Field(min_length=1, max_length=32)
    expected_duration_minutes: int = Field(ge=5, le=10080)


class VisitorGateRequest(BaseModel):
    """Kiosk / gate visitor registration pending admin approval."""

    name: str = Field(min_length=1, max_length=255)
    phone: str = Field(min_length=5, max_length=32)
    purpose: str = Field(min_length=1, max_length=512)
    plate_raw: str = Field(min_length=1, max_length=32)
    expected_duration_minutes: int = Field(ge=1, le=10080)


class VisitorApproval(BaseModel):
    approved: bool


class VisitorPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    phone: str
    purpose: str
    plate_raw: str
    expected_duration_minutes: int
    entered_at: datetime | None = None
    exited_at: datetime | None = None
    valid_until: datetime
    status: str
    created_at: datetime
