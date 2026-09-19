"""Seed service for the HR Recruitment Platform.
Creates rich, realistic demo data including jobs, candidates, multi-signal fraud scans,
evaluations, interviews, and offers for live UI exploration.
"""
import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session

from .. import models
from ..models import Application, Candidate, Role, User
from . import recruitment_service as rs


def seed_recruitment_demo(db: Session, user: User) -> dict:
    """Populates 3 realistic positions and 4 candidates across diverse pipeline stages."""
    # 1. Lead AI Systems Engineer
    job1 = db.query(Role).filter(Role.title == "Lead AI / ML Systems Engineer").first()
    if not job1:
        job1 = Role(
            id=str(uuid.uuid4()),
            title="Lead AI / ML Systems Engineer",
            department="AI Platform",
            location="San Francisco, CA (Hybrid)",
            description="Lead architecture and deployment of large-scale agentic AI workflows, vector search pipelines, and multi-modal models.",
            jd_text="Requirements: Python, PyTorch, LangChain, Vector Databases, FastAPI, and distributed worker pipelines.",
            min_experience_years=4.0,
            must_have_skills=["Python", "PyTorch", "FastAPI", "Vector Databases"],
            preferred_skills=["LangChain", "Celery", "Redis"],
            status="open",
            created_by=user.id,
            created_at=datetime.now(timezone.utc),
        )
        db.add(job1)

    # 2. Senior Full-Stack Engineer
    job2 = db.query(Role).filter(Role.title == "Senior Full-Stack Product Engineer").first()
    if not job2:
        job2 = Role(
            id=str(uuid.uuid4()),
            title="Senior Full-Stack Product Engineer",
            department="Product Engineering",
            location="New York, NY (Remote friendly)",
            description="High-velocity full-stack engineer building delightful experiences with Next.js, TypeScript, and modern backend services.",
            jd_text="Requirements: TypeScript, React 19, Next.js, TailwindCSS, PostgreSQL, REST/GraphQL APIs.",
            min_experience_years=3.0,
            must_have_skills=["TypeScript", "React", "Next.js", "PostgreSQL"],
            preferred_skills=["TailwindCSS", "GraphQL", "Figma"],
            status="open",
            created_by=user.id,
            created_at=datetime.now(timezone.utc),
        )
        db.add(job2)

    # 3. Enterprise Account Executive
    job3 = db.query(Role).filter(Role.title == "Strategic Enterprise Account Executive").first()
    if not job3:
        job3 = Role(
            id=str(uuid.uuid4()),
            title="Strategic Enterprise Account Executive",
            department="Global Sales",
            location="Austin, TX / Remote",
            description="Drive enterprise expansion for our AI policy and compliance engine across Fortune 500 accounts.",
            jd_text="5+ years enterprise SaaS quota-carrying sales experience. Track record of closing $100k+ ARR deals.",
            min_experience_years=5.0,
            must_have_skills=["Enterprise SaaS", "Solution Selling", "Executive Presentation"],
            preferred_skills=["Salesforce", "MEDDPICC"],
            status="open",
            created_by=user.id,
            created_at=datetime.now(timezone.utc),
        )
        db.add(job3)

    db.commit()
    db.refresh(job1)

    candidates_data = [
        {
            "name": "Dr. Marcus Chen",
            "email": "marcus.chen.ai@example.com",
            "phone": "+1 (415) 890-2341",
            "location": "San Francisco, CA",
            "current_role": "Staff ML Engineer at AnthroSphere",
            "experience_years": 6.5,
            "skills": ["Python", "PyTorch", "FastAPI", "Vector Databases", "LangChain", "CUDA"],
            "match_score": 94,
            "ats_score": 92,
            "stage": "INTERVIEW",
            "rec": "Strong Match",
            "summary": "Exceptional deep learning systems background. Published author in distributed transformer serving.",
            "fraud_risk": "low",
        },
        {
            "name": "Elena Rostova",
            "email": "elena.rostova@example.com",
            "phone": "+1 (510) 672-9118",
            "location": "Berkeley, CA",
            "current_role": "Senior AI Infrastructure Engineer",
            "experience_years": 5.0,
            "skills": ["Python", "FastAPI", "Vector Databases", "Redis", "Celery", "Docker"],
            "match_score": 88,
            "ats_score": 85,
            "stage": "OFFER",
            "rec": "Strong Match",
            "summary": "Robust engineering background in high-throughput inference serving. Strong fit for our vector retrieval stack.",
            "fraud_risk": "low",
        },
        {
            "name": "Devon Vance",
            "email": "devon.vance.tech@example.com",
            "phone": "+1 (206) 431-8977",
            "location": "Seattle, WA",
            "current_role": "Backend Engineer",
            "experience_years": 3.5,
            "skills": ["Python", "FastAPI", "PostgreSQL", "AWS"],
            "match_score": 74,
            "ats_score": 78,
            "stage": "SHORTLISTED",
            "rec": "Good Match",
            "summary": "Solid core backend skills. Lacks deep vector database production experience.",
            "fraud_risk": "low",
        },
        {
            "name": "Jordan Cole",
            "email": "jordan.cole.sample@example.com",
            "phone": "+1 (650) 332-9012",
            "location": "San Jose, CA",
            "current_role": "Software Developer",
            "experience_years": 2.0,
            "skills": ["Python", "Flask", "Docker"],
            "match_score": 58,
            "ats_score": 62,
            "stage": "APPLIED",
            "rec": "Potential Match",
            "summary": "Junior engineer with baseline Python skills.",
            "fraud_risk": "high",
        },
    ]

    for cdata in candidates_data:
        cand = db.query(Candidate).filter(Candidate.email == cdata["email"]).first()
        if not cand:
            cand = Candidate(
                id=str(uuid.uuid4()),
                name=cdata["name"],
                email=cdata["email"],
                email_key=rs.normalize_email(cdata["email"]),
                phone=cdata["phone"],
                location=cdata["location"],
                current_role=cdata["current_role"],
                experience_years=cdata["experience_years"],
                skills=cdata["skills"],
                resume_filename=f"{cdata['name'].lower().replace(' ', '_')}_cv.pdf",
                resume_text=f"{cdata['name']} Resume: {cdata['current_role']}. Skills: {', '.join(cdata['skills'])}. Experience: {cdata['experience_years']} years.",
                created_at=datetime.now(timezone.utc),
            )
            db.add(cand)
            db.flush()

        app = db.query(Application).filter(Application.candidate_id == cand.id, Application.job_id == job1.id).first()
        if not app:
            is_flagged = cdata["fraud_risk"] != "low"
            scan = models.FraudScan(
                id=str(uuid.uuid4()),
                filename=cand.resume_filename,
                file_path="/app/uploads/demo.pdf",
                content_type="pdf",
                status="complete",
                result={
                    "risk_level": "high" if is_flagged else "low",
                    "overall_score": 85 if is_flagged else 12,
                    "recommendation": "Flagged for Font/Text Manipulation" if is_flagged else "Document Verified Clean",
                    "findings": [
                        {"category": "Visual Anomalies", "description": "Micro-font white text keyword injection detected in footer."}
                    ] if is_flagged else [],
                },
                created_at=datetime.now(timezone.utc),
            )
            db.add(scan)
            db.flush()

            app = Application(
                id=str(uuid.uuid4()),
                candidate_id=cand.id,
                job_id=job1.id,
                stage=cdata["stage"],
                match_score=cdata["match_score"],
                ats_score=cdata["ats_score"],
                matched_skills=[s for s in cdata["skills"] if s in job1.must_have_skills or s in (job1.preferred_skills or [])],
                missing_skills=[s for s in job1.must_have_skills if s not in cdata["skills"]],
                recommendation=cdata["rec"],
                ai_summary=cdata["summary"],
                analysis_status="completed",
                score_provenance={
                    "ats_score": {"status": "computed", "source": rs.SOURCE_DETERMINISTIC},
                    "match_score": {"status": "computed", "source": rs.SOURCE_LLM},
                },
                fraud_scan_id=scan.id,
                created_at=datetime.now(timezone.utc),
            )
            db.add(app)
            db.flush()

            if cdata["stage"] in ("INTERVIEW", "OFFER"):
                interview = models.Interview(
                    id=str(uuid.uuid4()),
                    application_id=app.id,
                    candidate_id=cand.id,
                    job_id=job1.id,
                    mode="human",
                    scheduled_at=datetime.now(timezone.utc) + timedelta(days=2),
                    interviewer_email=user.email,
                    meet_link=f"https://meet.google.com/{uuid.uuid4().hex[:3]}-{uuid.uuid4().hex[:4]}-{uuid.uuid4().hex[:3]}",
                    status="scheduled",
                    created_at=datetime.now(timezone.utc),
                )
                db.add(interview)

            if cdata["stage"] == "OFFER":
                offer = models.Offer(
                    id=str(uuid.uuid4()),
                    application_id=app.id,
                    candidate_id=cand.id,
                    job_id=job1.id,
                    status="draft",
                    salary=245000.0,
                    currency="USD",
                    equity="0.35%",
                    role_title="Lead AI Systems Engineer",
                    start_date="2026-11-01",
                    expiry_date="2026-11-08",
                    notes="Comprehensive Health, Dental, Vision, 401(k) 4% match, $5k/yr Learning Stipend.",
                    created_by=user.id,
                    created_at=datetime.now(timezone.utc),
                )
                db.add(offer)

    db.commit()
    return {"message": "Demo recruitment pipeline seeded successfully!", "jobs_count": 3, "candidates_count": 4}
