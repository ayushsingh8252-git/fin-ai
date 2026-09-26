"""Add candidates.summary and candidates.work_history (resume-parsed).

Revision ID: c1d4e7a9b2f3
Revises: b8f2a6c4d913

Idempotent, like the rest of this chain: main.py's lifespan hook adds these
same columns at startup (deploys don't run alembic), so skip what exists.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c1d4e7a9b2f3"
down_revision: Union[str, Sequence[str], None] = "b8f2a6c4d913"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns() -> set:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns("candidates")}


def upgrade() -> None:
    existing = _columns()
    if "summary" not in existing:
        op.add_column("candidates", sa.Column("summary", sa.Text(), nullable=True))
    if "work_history" not in existing:
        op.add_column("candidates", sa.Column("work_history", sa.JSON(), nullable=True))


def downgrade() -> None:
    existing = _columns()
    with op.batch_alter_table("candidates") as batch:
        if "work_history" in existing:
            batch.drop_column("work_history")
        if "summary" in existing:
            batch.drop_column("summary")
