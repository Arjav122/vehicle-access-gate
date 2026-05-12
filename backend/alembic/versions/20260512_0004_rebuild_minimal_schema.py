"""Rebuild schema to minimal vehicle access workflow.

Revision ID: 20260512_0004
Revises: 20260512_0003
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260512_0004"
down_revision: Union[str, None] = "20260512_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop old tables and rebuild cleanly (safe because environment is empty).
    op.execute("DROP TABLE IF EXISTS access_logs CASCADE")
    op.execute("DROP TABLE IF EXISTS alerts CASCADE")
    op.execute("DROP TABLE IF EXISTS vehicles CASCADE")
    op.execute("DROP TABLE IF EXISTS settings CASCADE")
    op.execute("DROP TABLE IF EXISTS visitors CASCADE")
    op.execute("DROP TABLE IF EXISTS residents CASCADE")
    op.execute("DROP TABLE IF EXISTS admins CASCADE")

    op.execute("DROP TYPE IF EXISTS visitor_status CASCADE")
    op.execute("DROP TYPE IF EXISTS alert_severity CASCADE")
    op.execute("DROP TYPE IF EXISTS log_event_type CASCADE")

    visitor_status = postgresql.ENUM("valid", "expired", "pending", "rejected", name="visitor_status")
    alert_severity = postgresql.ENUM("low", "medium", "high", "critical", name="alert_severity")
    visitor_status.create(op.get_bind(), checkfirst=True)
    alert_severity.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "admins",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_admins_email", "admins", ["email"], unique=False)

    op.create_table(
        "residents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("vehicle_plate_number", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_residents_phone", "residents", ["phone"], unique=False)
    op.create_index("ix_residents_vehicle_plate_number", "residents", ["vehicle_plate_number"], unique=False)

    op.create_table(
        "visitors",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("purpose", sa.String(length=512), nullable=False),
        sa.Column("plate_raw", sa.String(length=32), nullable=False),
        sa.Column("expected_duration_minutes", sa.Integer(), nullable=False),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "status",
            postgresql.ENUM(
                "valid", "expired", "pending", "rejected", name="visitor_status", create_type=False
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_visitors_plate_raw", "visitors", ["plate_raw"], unique=False)
    op.create_index("ix_visitors_status", "visitors", ["status"], unique=False)

    op.create_table(
        "alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("alert_type", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "severity",
            postgresql.ENUM(
                "low", "medium", "high", "critical", name="alert_severity", create_type=False
            ),
            nullable=False,
            server_default="medium",
        ),
        sa.Column("plate_normalized", sa.String(length=32), nullable=True),
        sa.Column("visitor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_alerts_created_at", "alerts", ["created_at"], unique=False)
    op.create_index("ix_alerts_resolved", "alerts", ["resolved"], unique=False)
    op.create_index("ix_alerts_plate_normalized", "alerts", ["plate_normalized"], unique=False)

    op.create_table(
        "access_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plate_normalized", sa.String(length=32), nullable=False),
        sa.Column("user_type", sa.String(length=32), nullable=False),
        sa.Column("user_name", sa.String(length=255), nullable=False),
        sa.Column("access_result", sa.String(length=64), nullable=False),
        sa.Column("visitor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_access_logs_created_at", "access_logs", ["created_at"], unique=False)
    op.create_index("ix_access_logs_plate_normalized", "access_logs", ["plate_normalized"], unique=False)


def downgrade() -> None:
    raise NotImplementedError("Destructive migration; downgrade is not supported.")
