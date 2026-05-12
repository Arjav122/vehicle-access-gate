from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AccessLogPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    plate_normalized: str
    event_type: str
    authorized: bool
    created_at: datetime
    notes: str | None = None


class DashboardSummary(BaseModel):
    entries_today: int
    exits_today: int
    vehicles_inside: int
    active_visitors: int
    open_alerts: int
    recent_logs: list[AccessLogPublic]
