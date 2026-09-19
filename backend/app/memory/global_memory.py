"""Shared/global memory — roles, job descriptions, company policy, and
onboarding SOPs that every agent reads from the same source of truth.

Uses the existing primary SQLite database (app/database.py), the same one
Document/Rule/Chunk already live in — company policy itself is already
"shared memory" via the RAG-ingested Rule table, so this module adds the two
pieces that weren't modeled yet (Role, OnboardingSOP) rather than starting a
second store. This is intentionally SQLite, not Postgres: it's small,
read-heavy, and already the platform's system of record for this data.
"""
import uuid
from typing import Optional

from ..database import SessionLocal
from ..models import OnboardingSOP, Role, Rule


def upsert_role(title: str, jd_text: str = "", department: Optional[str] = None, must_have_skills: Optional[list] = None) -> dict:
    db = SessionLocal()
    try:
        role = db.query(Role).filter(Role.title == title).first()
        if role is None:
            role = Role(id=str(uuid.uuid4()), title=title)
            db.add(role)
        if role.created_by is None:
            # Agent-owned row (auto-created by usage): the agents keep it fresh.
            role.jd_text = jd_text or role.jd_text
            role.department = department if department is not None else role.department
            role.must_have_skills = must_have_skills if must_have_skills is not None else (role.must_have_skills or [])
        else:
            # A person owns this job in the HR recruitment panel. An agent that
            # merely names the role (a screening session, a call) must never
            # overwrite what that person wrote, so it may only fill blanks.
            role.jd_text = role.jd_text or jd_text or None
            role.department = role.department or department
            role.must_have_skills = role.must_have_skills or must_have_skills or []
        db.commit()
        return {"id": role.id, "title": role.title, "jd_text": role.jd_text, "department": role.department, "must_have_skills": role.must_have_skills}
    finally:
        db.close()


def get_role(title: str) -> Optional[dict]:
    db = SessionLocal()
    try:
        role = db.query(Role).filter(Role.title == title).first()
        if not role:
            return None
        return {"id": role.id, "title": role.title, "jd_text": role.jd_text, "department": role.department, "must_have_skills": role.must_have_skills}
    finally:
        db.close()


def get_onboarding_sops(topic: Optional[str] = None) -> list[dict]:
    db = SessionLocal()
    try:
        q = db.query(OnboardingSOP)
        if topic:
            q = q.filter(OnboardingSOP.topic == topic)
        return [{"id": s.id, "topic": s.topic, "title": s.title, "steps": s.steps} for s in q.all()]
    finally:
        db.close()


def search_company_policy(keyword: str, limit: int = 5) -> list[dict]:
    """Thin read over the existing ingested-policy corpus (Rule table) so
    other agents (e.g. Telephonic/Screening answering a candidate's policy
    question) can pull from the same shared memory the RAG chat uses,
    without duplicating retrieval.py's Pinecone-backed semantic search for a
    simple keyword lookup."""
    db = SessionLocal()
    try:
        rows = db.query(Rule).filter(Rule.canonical_rule.ilike(f"%{keyword}%")).limit(limit).all()
        return [{"id": r.id, "canonical_rule": r.canonical_rule, "type": r.type, "document_id": r.document_id} for r in rows]
    finally:
        db.close()
