"""Add call record provider

Revision ID: d6e91b4f2a08
Revises: a1c9f4e82b17
Create Date: 2026-08-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd6e91b4f2a08'
down_revision: Union[str, Sequence[str], None] = 'a1c9f4e82b17'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('call_records', sa.Column('provider', sa.String(), nullable=False, server_default='twilio'))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('call_records', 'provider')
