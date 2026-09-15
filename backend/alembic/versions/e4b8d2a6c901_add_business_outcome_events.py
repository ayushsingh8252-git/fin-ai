"""Add business outcome measurement ledger.

Revision ID: e4b8d2a6c901
Revises: c5a2d8e3f1b7
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e4b8d2a6c901"
down_revision: Union[str, Sequence[str], None] = "c5a2d8e3f1b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "business_outcome_events",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workflow_type", sa.String(), nullable=False),
        sa.Column("workflow_id", sa.String(), nullable=False),
        sa.Column("langfuse_trace_id", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("automated", sa.String(), nullable=False),
        sa.Column("manual_baseline_minutes", sa.Float(), nullable=True),
        sa.Column("human_active_minutes", sa.Float(), nullable=True),
        sa.Column("labor_cost_per_hour_usd", sa.Float(), nullable=True),
        sa.Column("ai_cost_usd", sa.Float(), nullable=True),
        sa.Column("review_outcome", sa.String(), nullable=True),
        sa.Column("required_rework", sa.String(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("id", "workflow_type", "workflow_id", "langfuse_trace_id", "status", "review_outcome", "created_at"):
        op.create_index(op.f("ix_business_outcome_events_" + column), "business_outcome_events", [column], unique=False)


def downgrade() -> None:
    for column in ("created_at", "review_outcome", "status", "langfuse_trace_id", "workflow_id", "workflow_type", "id"):
        op.drop_index(op.f("ix_business_outcome_events_" + column), table_name="business_outcome_events")
    op.drop_table("business_outcome_events")
