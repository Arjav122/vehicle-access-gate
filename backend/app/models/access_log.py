from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
class AccessLog(Base):
    __tablename__ = "access_logs"
    __table_args__ = (
        Index("ix_access_logs_created_at", "created_at"),
        Index("ix_access_logs_plate_normalized", "plate_normalized"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    plate_normalized: Mapped[str] = mapped_column(String(32), nullable=False)
    user_type: Mapped[str] = mapped_column(String(32), nullable=False)
    user_name: Mapped[str] = mapped_column(String(255), nullable=False)
    access_result: Mapped[str] = mapped_column(String(64), nullable=False)
    visitor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("visitors.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    visitor: Mapped["Visitor | None"] = relationship("Visitor", back_populates="access_logs")
