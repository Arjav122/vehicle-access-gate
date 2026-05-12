from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AlertPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    alert_type: str
    title: str
    message: str
    severity: str
    plate_normalized: str | None
    visitor_id: UUID | None
    resolved: bool
    created_at: datetime
    updated_at: datetime


class AlertResolve(BaseModel):
    resolved: bool = True
