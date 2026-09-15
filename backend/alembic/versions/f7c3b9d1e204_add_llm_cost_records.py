"""Add local LLM cost governance ledger.

Revision ID: f7c3b9d1e204
Revises: e4b8d2a6c901
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "f7c3b9d1e204"
down_revision: Union[str, Sequence[str], None] = "e4b8d2a6c901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "llm_cost_records",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("langfuse_trace_id", sa.String(), nullable=True),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("cache_read_input_tokens", sa.Integer(), nullable=True),
        sa.Column("cost_usd", sa.Float(), nullable=True),
        sa.Column("cost_source", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("id", "langfuse_trace_id", "provider", "model", "created_at"):
        op.create_index(op.f("ix_llm_cost_records_" + column), "llm_cost_records", [column], unique=False)


def downgrade() -> None:
    for column in ("created_at", "model", "provider", "langfuse_trace_id", "id"):
        op.drop_index(op.f("ix_llm_cost_records_" + column), table_name="llm_cost_records")
    op.drop_table("llm_cost_records")
