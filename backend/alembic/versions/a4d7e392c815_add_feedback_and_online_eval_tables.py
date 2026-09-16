"""Add feedback events and online eval results tables.

Revision ID: a4d7e392c815
Revises: f7c3b9d1e204
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "a4d7e392c815"
down_revision: Union[str, Sequence[str], None] = "f7c3b9d1e204"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "feedback_events",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workflow_type", sa.String(), nullable=False),
        sa.Column("subject_id", sa.String(), nullable=False),
        sa.Column("langfuse_trace_id", sa.String(), nullable=True),
        sa.Column("rating", sa.String(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("id", "workflow_type", "subject_id", "langfuse_trace_id", "created_at"):
        op.create_index(op.f("ix_feedback_events_" + column), "feedback_events", [column], unique=False)

    op.create_table(
        "online_eval_results",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("langfuse_trace_id", sa.String(), nullable=False),
        sa.Column("workflow_type", sa.String(), nullable=False),
        sa.Column("check_name", sa.String(), nullable=False),
        sa.Column("passed", sa.String(), nullable=False),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("id", "langfuse_trace_id", "workflow_type", "check_name", "created_at"):
        op.create_index(op.f("ix_online_eval_results_" + column), "online_eval_results", [column], unique=False)


def downgrade() -> None:
    for column in ("created_at", "check_name", "workflow_type", "langfuse_trace_id", "id"):
        op.drop_index(op.f("ix_online_eval_results_" + column), table_name="online_eval_results")
    op.drop_table("online_eval_results")

    for column in ("created_at", "langfuse_trace_id", "subject_id", "workflow_type", "id"):
        op.drop_index(op.f("ix_feedback_events_" + column), table_name="feedback_events")
    op.drop_table("feedback_events")
