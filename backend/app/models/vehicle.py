from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (
        UniqueConstraint("plate_normalized", name="uq_vehicles_plate_normalized"),
        Index("ix_vehicles_plate_normalized", "plate_normalized"),
        Index("ix_vehicles_inside", "is_inside"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    resident_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("residents.id", ondelete="SET NULL"), nullable=True
    )
    plate_raw: Mapped[str] = mapped_column(String(32), nullable=False)
    plate_normalized: Mapped[str] = mapped_column(String(32), nullable=False)
    make: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    vehicle_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_inside: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_entry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_exit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    resident: Mapped["Resident | None"] = relationship("Resident", back_populates="vehicles")
    access_logs: Mapped[list["AccessLog"]] = relationship("AccessLog", back_populates="vehicle")
