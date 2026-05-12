"""Gate workflow: visitor approval statuses, visit_unit, vehicle_type, registration log type.

Revision ID: 20260212_0002
Revises: 20250511_0001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260212_0002"
down_revision: Union[str, None] = "20250511_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("vehicles", sa.Column("vehicle_type", sa.String(length=64), nullable=True))
    op.add_column("visitors", sa.Column("visit_unit", sa.String(length=128), nullable=True))

    # PostgreSQL: extend native enums (IF NOT EXISTS requires PG15+; Supabase uses PG15).
    op.execute(sa.text("ALTER TYPE visitor_status ADD VALUE IF NOT EXISTS 'pending_approval'"))
    op.execute(sa.text("ALTER TYPE visitor_status ADD VALUE IF NOT EXISTS 'rejected'"))
    op.execute(sa.text("ALTER TYPE log_event_type ADD VALUE IF NOT EXISTS 'registration'"))


def downgrade() -> None:
    op.drop_column("visitors", "visit_unit")
    op.drop_column("vehicles", "vehicle_type")
    # Enum values are not removed in downgrade (Postgres limitation).
