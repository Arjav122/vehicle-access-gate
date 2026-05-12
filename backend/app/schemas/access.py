from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AccessProcessResult(BaseModel):
    authorized: bool
    action: Literal["authorized", "unauthorized", "visitor_request", "expired_access"]
    message: str
    log_id: UUID | None = None
    requires_visitor_registration: bool = False
    # Gate UI: populated when a registered vehicle is processed
    resident_name: str | None = None
    unit_number: str | None = None
    vehicle_type: str | None = Field(
        default=None,
        description="Display label: vehicle_type field or make/model.",
    )


class AccessLogListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    plate_normalized: str
    user_type: str
    user_name: str
    access_result: str
    created_at: datetime
    visitor_id: UUID | None = None
