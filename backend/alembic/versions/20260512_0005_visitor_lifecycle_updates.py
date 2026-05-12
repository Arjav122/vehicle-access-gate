"""Visitor lifecycle updates: entered/overstayed and entry-exit timestamps.

Revision ID: 20260512_0005
Revises: 20260512_0004
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260512_0005"
down_revision: Union[str, None] = "20260512_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TYPE visitor_status ADD VALUE IF NOT EXISTS 'entered'"))
    op.execute(sa.text("ALTER TYPE visitor_status ADD VALUE IF NOT EXISTS 'overstayed'"))

    op.add_column("visitors", sa.Column("entered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("visitors", sa.Column("exited_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("visitors", "exited_at")
    op.drop_column("visitors", "entered_at")
    # Enum value removal is not supported safely on Postgres.
