"""Add HR recruitment panel tables and RBAC/ownership columns.

Revision ID: b8f2a6c4d913
Revises: a4d7e392c815

Idempotent by construction. The lifespan hook in main.py runs create_all() on
every startup, and most tables in this app (users, roles, fraud_scans, ...)
have never had a create-table migration, so by the time alembic upgrade head
runs, some or all of what is below may already exist. Every step therefore
checks the live schema first and skips what is already there, instead of
assuming a clean slate.

Same caveat as every other migration in this chain: it assumes the tables it
references (users, roles, fraud_scans, screening_sessions) already exist.
alembic upgrade head alone still cannot build a database from nothing;
create_all() at startup remains required.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b8f2a6c4d913"
down_revision: Union[str, Sequence[str], None] = "a4d7e392c815"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TS = dict(server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True)


def _insp():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return _insp().has_table(name)


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in _insp().get_columns(table)}


def _add_column_if_missing(table: str, column: sa.Column) -> None:
    # Skip when the table itself does not exist yet: create_all() will build
    # it with the new column already in place.
    if _has_table(table) and not _has_column(table, column.name):
        with op.batch_alter_table(table) as batch:
            batch.add_column(column)


def _create_index_if_missing(name: str, table: str, cols: list, unique: bool = False) -> None:
    if name not in {i["name"] for i in _insp().get_indexes(table)}:
        op.create_index(name, table, cols, unique=unique)


def _index_all(table: str, cols) -> None:
    for c in cols:
        op.create_index(op.f(f"ix_{table}_{c}"), table, [c])


def upgrade() -> None:
    # Columns on existing tables. server_default matters: existing users
    # become "recruiter" (what they effectively already were, see
    # models.User.role) and existing roles become "draft" jobs.
    _add_column_if_missing("users", sa.Column("role", sa.String(), nullable=False, server_default="recruiter"))
    for col in (
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("location", sa.String(), nullable=True),
        sa.Column("min_experience_years", sa.Float(), nullable=True),
        sa.Column("preferred_skills", sa.JSON(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        # No FK constraint here: SQLite cannot ADD a constraint to an existing
        # table without a full rebuild, and Role rows predate this column.
        # The ORM model still declares the FK.
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
    ):
        _add_column_if_missing("roles", col)
    if _has_table("users"):
        _create_index_if_missing("ix_users_role", "users", ["role"])
    if _has_table("roles"):
        _create_index_if_missing("ix_roles_status", "roles", ["status"])
        _create_index_if_missing("ix_roles_created_by", "roles", ["created_by"])

    # New tables, parents before children.
    if not _has_table("candidates"):
        op.create_table(
            "candidates",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("email", sa.String(), nullable=True),
            sa.Column("email_key", sa.String(), nullable=True),
            sa.Column("name", sa.String(), nullable=True),
            sa.Column("name_key", sa.String(), nullable=True),
            sa.Column("phone", sa.String(), nullable=True),
            sa.Column("phone_key", sa.String(), nullable=True),
            sa.Column("location", sa.String(), nullable=True),
            sa.Column("current_role", sa.String(), nullable=True),
            sa.Column("experience_text", sa.String(), nullable=True),
            sa.Column("experience_years", sa.Float(), nullable=True),
            sa.Column("education", sa.JSON(), nullable=True),
            sa.Column("skills", sa.JSON(), nullable=True),
            sa.Column("resume_file_path", sa.String(), nullable=True),
            sa.Column("resume_filename", sa.String(), nullable=True),
            sa.Column("resume_text", sa.Text(), nullable=True),
            sa.Column("source", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
            sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
            sa.PrimaryKeyConstraint("id"),
        )
        _index_all("candidates", ("id", "email", "email_key", "name_key", "phone_key"))
        # DB-level dedupe guard, mirrors models.Candidate.__table_args__.
        op.create_index(
            "uq_candidates_email_key", "candidates", ["email_key"], unique=True,
            sqlite_where=sa.text("email_key IS NOT NULL"),
            postgresql_where=sa.text("email_key IS NOT NULL"),
        )

    if not _has_table("applications"):
        op.create_table(
            "applications",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("candidate_id", sa.String(), nullable=False),
            sa.Column("job_id", sa.String(), nullable=False),
            sa.Column("stage", sa.String(), nullable=False, server_default="PROCESSING"),
            sa.Column("ats_score", sa.Integer(), nullable=True),
            sa.Column("match_score", sa.Integer(), nullable=True),
            sa.Column("skill_match_score", sa.Integer(), nullable=True),
            sa.Column("matched_skills", sa.JSON(), nullable=True),
            sa.Column("missing_skills", sa.JSON(), nullable=True),
            sa.Column("recommendation", sa.String(), nullable=True),
            sa.Column("ai_summary", sa.Text(), nullable=True),
            sa.Column("score_provenance", sa.JSON(), nullable=True),
            sa.Column("analysis_status", sa.String(), nullable=False, server_default="pending"),
            sa.Column("analysis_error", sa.Text(), nullable=True),
            sa.Column("fraud_scan_id", sa.String(), nullable=True),
            sa.Column("screening_session_id", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
            sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
            sa.ForeignKeyConstraint(["candidate_id"], ["candidates.id"]),
            sa.ForeignKeyConstraint(["job_id"], ["roles.id"]),
            sa.ForeignKeyConstraint(["fraud_scan_id"], ["fraud_scans.id"]),
            sa.ForeignKeyConstraint(["screening_session_id"], ["screening_sessions.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("candidate_id", "job_id", name="uq_application_candidate_job"),
        )
        _index_all(
            "applications",
            ("id", "candidate_id", "job_id", "stage", "analysis_status", "fraud_scan_id", "screening_session_id"),
        )
        op.create_index("ix_applications_job_stage", "applications", ["job_id", "stage"])

    if not _has_table("resume_batches"):
        op.create_table(
            "resume_batches",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("job_id", sa.String(), nullable=False),
            sa.Column("uploaded_by", sa.String(), nullable=True),
            sa.Column("total_files", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
            sa.ForeignKeyConstraint(["job_id"], ["roles.id"]),
            sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        _index_all("resume_batches", ("id", "job_id", "uploaded_by"))

    if not _has_table("resume_uploads"):
        op.create_table(
            "resume_uploads",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("batch_id", sa.String(), nullable=False),
            sa.Column("job_id", sa.String(), nullable=False),
            sa.Column("original_filename", sa.String(), nullable=False),
            sa.Column("stored_path", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=False, server_default="queued"),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("candidate_id", sa.String(), nullable=True),
            sa.Column("application_id", sa.String(), nullable=True),
            sa.Column("task_id", sa.String(), nullable=True),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
            sa.Column("updated_at", sa.DateTime(timezone=True), **_TS),
            sa.ForeignKeyConstraint(["batch_id"], ["resume_batches.id"]),
            sa.ForeignKeyConstraint(["job_id"], ["roles.id"]),
            sa.ForeignKeyConstraint(["candidate_id"], ["candidates.id"]),
            sa.ForeignKeyConstraint(["application_id"], ["applications.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        _index_all("resume_uploads", ("id", "batch_id", "job_id", "status", "candidate_id", "application_id"))

    if not _has_table("candidate_activities"):
        op.create_table(
            "candidate_activities",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("candidate_id", sa.String(), nullable=False),
            sa.Column("application_id", sa.String(), nullable=True),
            sa.Column("job_id", sa.String(), nullable=True),
            sa.Column("event_type", sa.String(), nullable=False),
            sa.Column("actor_type", sa.String(), nullable=False, server_default="system"),
            sa.Column("actor_user_id", sa.String(), nullable=True),
            sa.Column("summary", sa.String(), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=True),
            sa.Column("dedupe_key", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
            sa.ForeignKeyConstraint(["candidate_id"], ["candidates.id"]),
            sa.ForeignKeyConstraint(["application_id"], ["applications.id"]),
            sa.ForeignKeyConstraint(["job_id"], ["roles.id"]),
            sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("dedupe_key", name="uq_candidate_activity_dedupe_key"),
        )
        _index_all(
            "candidate_activities",
            ("id", "candidate_id", "application_id", "job_id", "event_type", "actor_user_id", "created_at"),
        )
        op.create_index(
            "ix_candidate_activities_candidate_created", "candidate_activities", ["candidate_id", "created_at"]
        )


    if not _has_table("interviews"):
        op.create_table(
            "interviews",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("application_id", sa.String(), nullable=False),
            sa.Column("candidate_id", sa.String(), nullable=False),
            sa.Column("job_id", sa.String(), nullable=False),
            sa.Column("mode", sa.String(), nullable=False, server_default="human"),
            sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("interviewer_email", sa.String(), nullable=True),
            sa.Column("calendar_event_id", sa.String(), nullable=True),
            sa.Column("meet_link", sa.String(), nullable=True),
            sa.Column("status", sa.String(), nullable=False, server_default="scheduled"),
            sa.Column("screening_session_id", sa.String(), nullable=True),
            sa.Column("call_record_id", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), **_TS),
            sa.ForeignKeyConstraint(["application_id"], ["applications.id"]),
            sa.ForeignKeyConstraint(["candidate_id"], ["candidates.id"]),
            sa.ForeignKeyConstraint(["job_id"], ["roles.id"]),
            sa.ForeignKeyConstraint(["screening_session_id"], ["screening_sessions.id"]),
            sa.ForeignKeyConstraint(["call_record_id"], ["call_records.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        _index_all(
            "interviews",
            ("id", "application_id", "candidate_id", "job_id", "interviewer_email",
             "screening_session_id", "call_record_id"),
        )


def downgrade() -> None:
    # Children first. Dropping a table that is not there is skipped so a
    # downgrade after a partial upgrade does not wedge.
    for table in ("interviews", "candidate_activities", "resume_uploads", "resume_batches", "applications", "candidates"):
        if _has_table(table):
            op.drop_table(table)
    # The columns added to users/roles are intentionally left in place:
    # dropping them needs a table rebuild on SQLite and would destroy the
    # role assignments and job ownership recorded since the upgrade.
