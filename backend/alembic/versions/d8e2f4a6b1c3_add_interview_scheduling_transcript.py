"""Interview scheduling + server-kept interview transcript columns.

Revision ID: d8e2f4a6b1c3
Revises: c1d4e7a9b2f3

screening_sessions: transcript, started_at, completed_at
interviews: duration_minutes, calendar_html_link, status_detail, completed_at

Idempotent, like the rest of this chain: main.py's lifespan hook adds these
same columns at startup (deploys don't run alembic), so skip what exists.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d8e2f4a6b1c3"
down_revision: Union[str, Sequence[str], None] = "c1d4e7a9b2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = {
    "screening_sessions": [
        ("transcript", sa.JSON()),
        ("started_at", sa.DateTime(timezone=True)),
        ("completed_at", sa.DateTime(timezone=True)),
    ],
    "interviews": [
        ("duration_minutes", sa.Integer()),
        ("calendar_html_link", sa.String()),
        ("status_detail", sa.Text()),
        ("completed_at", sa.DateTime(timezone=True)),
    ],
}


def _columns(table: str) -> set:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    for table, cols in COLUMNS.items():
        existing = _columns(table)
        for name, type_ in cols:
            if name not in existing:
                op.add_column(table, sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    for table, cols in COLUMNS.items():
        existing = _columns(table)
        with op.batch_alter_table(table) as batch:
            for name, _ in reversed(cols):
                if name in existing:
                    batch.drop_column(name)
