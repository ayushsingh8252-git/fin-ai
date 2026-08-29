"""Add voice identification tables

Revision ID: c5a2d8e3f1b7
Revises: f2a7c19b6d4e
Create Date: 2026-08-30
"""
from alembic import op
import sqlalchemy as sa

revision = 'c5a2d8e3f1b7'
down_revision = 'f2a7c19b6d4e'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        'voice_prints',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('speaker_name', sa.String(), nullable=False),
        sa.Column('email', sa.String(), nullable=True),
        sa.Column('embedding', sa.JSON(), nullable=True),
        sa.Column('enrollment_count', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('status', sa.String(), nullable=True, server_default='enrolling'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_voice_prints_id'), 'voice_prints', ['id'])
    op.create_index(op.f('ix_voice_prints_speaker_name'), 'voice_prints', ['speaker_name'])
    op.create_index(op.f('ix_voice_prints_email'), 'voice_prints', ['email'])

    op.create_table(
        'voice_enrollments',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('speaker_id', sa.String(), sa.ForeignKey('voice_prints.id'), nullable=True),
        sa.Column('embedding', sa.JSON(), nullable=False),
        sa.Column('audio_quality_score', sa.Float(), nullable=True),
        sa.Column('speech_duration_sec', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_voice_enrollments_id'), 'voice_enrollments', ['id'])
    op.create_index(op.f('ix_voice_enrollments_speaker_id'), 'voice_enrollments', ['speaker_id'])


def downgrade() -> None:
    op.drop_table('voice_enrollments')
    op.drop_table('voice_prints')
