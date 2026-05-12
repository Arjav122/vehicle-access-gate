from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import VisitorStatus


class Visitor(Base):
    __tablename__ = "visitors"
    __table_args__ = (
        Index("ix_visitors_plate_raw", "plate_raw"),
        Index("ix_visitors_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str] = mapped_column(String(32), nullable=False)
    purpose: Mapped[str] = mapped_column(String(512), nullable=False)
    plate_raw: Mapped[str] = mapped_column(String(32), nullable=False)
    expected_duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    entered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    exited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[VisitorStatus] = mapped_column(
        Enum(
            VisitorStatus,
            name="visitor_status",
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
        default=VisitorStatus.VALID,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    access_logs: Mapped[list["AccessLog"]] = relationship("AccessLog", back_populates="visitor")
    alerts: Mapped[list["Alert"]] = relationship("Alert", back_populates="visitor")
