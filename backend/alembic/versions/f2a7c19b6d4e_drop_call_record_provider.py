"""Drop call record provider

Telephonic Agent is Sarvam-only now (Twilio removed) — the multi-provider
column is dead weight.

Revision ID: f2a7c19b6d4e
Revises: d6e91b4f2a08
Create Date: 2026-08-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2a7c19b6d4e'
down_revision: Union[str, Sequence[str], None] = 'd6e91b4f2a08'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column('call_records', 'provider')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('call_records', sa.Column('provider', sa.String(), nullable=False, server_default='sarvam'))
