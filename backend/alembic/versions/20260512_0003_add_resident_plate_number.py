"""Add resident vehicle plate number for direct authorization.

Revision ID: 20260512_0003
Revises: 20260212_0002
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260512_0003"
down_revision: Union[str, None] = "20260212_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "residents",
        sa.Column("vehicle_plate_number", sa.String(length=32), nullable=True),
    )
    op.create_index(
        "ix_residents_vehicle_plate_number",
        "residents",
        ["vehicle_plate_number"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_residents_vehicle_plate_number", table_name="residents")
    op.drop_column("residents", "vehicle_plate_number")
