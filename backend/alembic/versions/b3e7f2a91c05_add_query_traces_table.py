"""Add query_traces table for RAG execution observability

Revision ID: b3e7f2a91c05
Revises: 9a3f5c1e7b44
Create Date: 2026-08-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3e7f2a91c05'
down_revision: Union[str, Sequence[str], None] = '9a3f5c1e7b44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'query_traces',
        sa.Column('request_id', sa.String(), nullable=False),
        sa.Column('document_id', sa.String(), nullable=True),
        sa.Column('query_text', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=True),
        sa.Column('total_latency_ms', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('trace', sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint('request_id'),
    )
    op.create_index(op.f('ix_query_traces_request_id'), 'query_traces', ['request_id'], unique=False)
    op.create_index(op.f('ix_query_traces_document_id'), 'query_traces', ['document_id'], unique=False)
    op.create_index(op.f('ix_query_traces_status'), 'query_traces', ['status'], unique=False)
    op.create_index(op.f('ix_query_traces_created_at'), 'query_traces', ['created_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_query_traces_created_at'), table_name='query_traces')
    op.drop_index(op.f('ix_query_traces_status'), table_name='query_traces')
    op.drop_index(op.f('ix_query_traces_document_id'), table_name='query_traces')
    op.drop_index(op.f('ix_query_traces_request_id'), table_name='query_traces')
    op.drop_table('query_traces')
