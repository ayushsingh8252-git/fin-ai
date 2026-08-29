import os
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from .parsing import parse_pdf
from .screening_llm_service import (
    analyze_telephonic_screening,
    generate_question_set,
    get_jd_profile,
    get_resume_profile,
)


def parse_resume_and_generate_questions(
    file_bytes: bytes, role_title: str, jd_text: Optional[str]
) -> Dict[str, Any]:
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    try:
        blocks = parse_pdf(tmp_path)
        resume_text = "\n".join(b["text"] for b in blocks)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    # resume_profile and jd_profile are two independent LLM calls (different
    # inputs, no data dependency between them) that used to run sequentially
    # — that's pure added wall-clock latency for no reason, since network-bound
    # LLM calls parallelize fine over threads. Same token/dollar cost either
    # way, just not serialized. generate_question_set still runs after, since
    # it genuinely depends on both results.
    if jd_text and jd_text.strip():
        with ThreadPoolExecutor(max_workers=2) as pool:
            resume_future = pool.submit(get_resume_profile, resume_text)
            jd_future = pool.submit(get_jd_profile, jd_text)
            resume_profile = resume_future.result()
            jd_profile = jd_future.result()
    else:
        resume_profile = get_resume_profile(resume_text)
        jd_profile = None
    questions = generate_question_set(role_title, resume_profile, jd_profile)

    return {
        "resume_profile": resume_profile.model_dump(),
        "questions": [
            {"id": f"q{i + 1}", "category": q.category, "text": q.text} for i, q in enumerate(questions)
        ],
    }


def screen_call_transcript(
    call_id: Optional[str],
    candidate_name: str,
    role_title: str,
    jd_text: Optional[str],
    transcript: List[Dict[str, str]],
    db,
) -> Dict[str, Any]:
    """Runs the JD-aligned Screening Agent analysis over a finished
    Telephonic Agent conversation and persists the result — the
    Screening Agent step of Candidate -> Telephonic Agent -> Conversation
    -> Response Storage -> Screening Agent -> Screening Result."""
    from .. import models

    analysis = analyze_telephonic_screening(transcript, role_title, jd_text)

    result = models.ScreeningResult(
        id=str(uuid.uuid4()),
        source="telephonic",
        call_id=call_id,
        candidate_name=candidate_name,
        role_title=role_title,
        jd_text_used=jd_text,
        jd_match_score=analysis.jd_match_score,
        verdict=analysis.verdict,
        strengths=analysis.strengths,
        gaps=analysis.gaps,
        summary=analysis.summary,
    )
    db.add(result)
    db.commit()
    db.refresh(result)

    return _serialize_screening_result(result)


def _serialize_screening_result(result) -> Dict[str, Any]:
    return {
        "id": result.id,
        "source": result.source,
        "call_id": result.call_id,
        "candidate_name": result.candidate_name,
        "role_title": result.role_title,
        "jd_match_score": result.jd_match_score,
        "verdict": result.verdict,
        "strengths": result.strengths,
        "gaps": result.gaps,
        "summary": result.summary,
        "created_at": result.created_at.isoformat() if result.created_at else None,
    }
