"""Initial schema for AI Vehicle Access Management.

Revision ID: 20250511_0001
Revises:
Create Date: 2025-05-11

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20250511_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log_event_type = postgresql.ENUM("entry", "exit", name="log_event_type", create_type=False)
visitor_status = postgresql.ENUM(
    "active", "completed", "expired", name="visitor_status", create_type=False
)
alert_severity = postgresql.ENUM(
    "low", "medium", "high", "critical", name="alert_severity", create_type=False
)


def upgrade() -> None:
    log_event_type.create(op.get_bind(), checkfirst=True)
    visitor_status.create(op.get_bind(), checkfirst=True)
    alert_severity.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "admins",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index(op.f("ix_admins_email"), "admins", ["email"], unique=False)

    op.create_table(
        "residents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("unit_number", sa.String(length=64), nullable=True),
        sa.Column("site_label", sa.String(length=128), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_residents_phone"), "residents", ["phone"], unique=False)
    op.create_index(op.f("ix_residents_site_label"), "residents", ["site_label"], unique=False)
    op.create_index(op.f("ix_residents_unit_number"), "residents", ["unit_number"], unique=False)

    op.create_table(
        "settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_settings_key"),
    )
    op.create_index(op.f("ix_settings_key"), "settings", ["key"], unique=False)

    op.create_table(
        "vehicles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("resident_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("plate_raw", sa.String(length=32), nullable=False),
        sa.Column("plate_normalized", sa.String(length=32), nullable=False),
        sa.Column("make", sa.String(length=64), nullable=True),
        sa.Column("model", sa.String(length=64), nullable=True),
        sa.Column("color", sa.String(length=32), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("is_inside", sa.Boolean(), nullable=False),
        sa.Column("last_entry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_exit_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["resident_id"], ["residents.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plate_normalized", name="uq_vehicles_plate_normalized"),
    )
    op.create_index("ix_vehicles_inside", "vehicles", ["is_inside"], unique=False)
    op.create_index("ix_vehicles_plate_normalized", "vehicles", ["plate_normalized"], unique=False)

    op.create_table(
        "visitors",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("purpose", sa.String(length=512), nullable=False),
        sa.Column("meet_person", sa.String(length=255), nullable=False),
        sa.Column("plate_raw", sa.String(length=32), nullable=False),
        sa.Column("plate_normalized", sa.String(length=32), nullable=False),
        sa.Column("expected_duration_minutes", sa.Integer(), nullable=False),
        sa.Column("grace_period_minutes", sa.Integer(), nullable=False),
        sa.Column("pass_code", sa.String(length=64), nullable=False),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", visitor_status, nullable=False),
        sa.Column("overstay_alert_sent", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pass_code"),
    )
    op.create_index(op.f("ix_visitors_pass_code"), "visitors", ["pass_code"], unique=False)
    op.create_index("ix_visitors_plate_normalized", "visitors", ["plate_normalized"], unique=False)
    op.create_index("ix_visitors_status", "visitors", ["status"], unique=False)

    op.create_table(
        "alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("alert_type", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("severity", alert_severity, nullable=False),
        sa.Column("plate_normalized", sa.String(length=32), nullable=True),
        sa.Column("visitor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolved", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_alerts_alert_type"), "alerts", ["alert_type"], unique=False)
    op.create_index("ix_alerts_created_at", "alerts", ["created_at"], unique=False)
    op.create_index("ix_alerts_resolved", "alerts", ["resolved"], unique=False)
    op.create_index("ix_alerts_plate_normalized", "alerts", ["plate_normalized"], unique=False)

    op.create_table(
        "access_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plate_normalized", sa.String(length=32), nullable=False),
        sa.Column("event_type", log_event_type, nullable=False),
        sa.Column("authorized", sa.Boolean(), nullable=False),
        sa.Column("vehicle_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("visitor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("actor", sa.String(length=64), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("context_json", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["visitor_id"], ["visitors.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_access_logs_created_at", "access_logs", ["created_at"], unique=False)
    op.create_index("ix_access_logs_event_type", "access_logs", ["event_type"], unique=False)
    op.create_index("ix_access_logs_plate_normalized", "access_logs", ["plate_normalized"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_access_logs_plate_normalized", table_name="access_logs")
    op.drop_index("ix_access_logs_event_type", table_name="access_logs")
    op.drop_index("ix_access_logs_created_at", table_name="access_logs")
    op.drop_table("access_logs")

    op.drop_index("ix_alerts_plate_normalized", table_name="alerts")
    op.drop_index("ix_alerts_resolved", table_name="alerts")
    op.drop_index("ix_alerts_created_at", table_name="alerts")
    op.drop_index(op.f("ix_alerts_alert_type"), table_name="alerts")
    op.drop_table("alerts")

    op.drop_index("ix_visitors_status", table_name="visitors")
    op.drop_index("ix_visitors_plate_normalized", table_name="visitors")
    op.drop_index(op.f("ix_visitors_pass_code"), table_name="visitors")
    op.drop_table("visitors")

    op.drop_index("ix_vehicles_plate_normalized", table_name="vehicles")
    op.drop_index("ix_vehicles_inside", table_name="vehicles")
    op.drop_table("vehicles")

    op.drop_index(op.f("ix_settings_key"), table_name="settings")
    op.drop_table("settings")

    op.drop_index(op.f("ix_residents_unit_number"), table_name="residents")
    op.drop_index(op.f("ix_residents_site_label"), table_name="residents")
    op.drop_index(op.f("ix_residents_phone"), table_name="residents")
    op.drop_table("residents")

    op.drop_index(op.f("ix_admins_email"), table_name="admins")
    op.drop_table("admins")

    alert_severity.drop(op.get_bind(), checkfirst=True)
    visitor_status.drop(op.get_bind(), checkfirst=True)
    log_event_type.drop(op.get_bind(), checkfirst=True)
