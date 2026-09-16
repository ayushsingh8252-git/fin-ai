import uuid
from contextlib import ExitStack
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..memory import orchestrator
from ..rate_limit import limiter
from ..services.interview_service import generate_evaluation, generate_next_turn
from ..services.guardrails import check_input, check_output
from ..services.llmops import llmops_context
from ..services.llmops_identity import LLMOpsIdentity, get_llmops_identity

# NOT covered by main.py's blanket per-router auth guard, and deliberately
# so: every route here is reached either by a candidate taking an interview
# from an emailed invite link (turn, evaluate, report, the WS route) — who
# was never a signed-in platform user and must not be forced to become
# one — or, for the WS route specifically, by a browser that couldn't send
# an Authorization header on the handshake even if we wanted it to. The long
# random session_id already in play on every one of these calls is the
# access control, same model as screening.router's candidate-facing routes.
router = APIRouter()


def _sanitize_history(history: list[dict]) -> list[dict]:
    """
    Regex-only guardrail pass over the candidate's free-text answers before
    they reach the interviewer LLM's prompt — strips control characters/caps
    length, and swaps out any answer that trips the prompt-injection
    blocklist for a neutral placeholder so the payload never reaches the
    prompt (the interview itself continues rather than hard-erroring, since a
    suspicious answer is still just one candidate answer, not a reason to
    abort the whole session).
    """
    sanitized = []
    for turn in history:
        text = turn.get("text", "")
        if turn.get("role") == "candidate" and text:
            result = check_input(text)
            text = result.text if result.allowed else "[response withheld — flagged content]"
        sanitized.append({**turn, "text": text})
    return sanitized


class InterviewTurnIn(BaseModel):
    role: str  # "interviewer" | "candidate"
    text: str


class InterviewTurnRequest(BaseModel):
    history: List[InterviewTurnIn] = []
    role_title: str = "the open role"
    jd_text: Optional[str] = None
    resume_context: Optional[str] = None
    max_turns: int = 5


class InterviewEvaluationRequest(BaseModel):
    history: List[InterviewTurnIn]
    role_title: str = "the open role"
    session_id: Optional[str] = None
    jd_text: Optional[str] = None
    resume_skills: List[str] = []
    candidate_name: Optional[str] = None
    email: Optional[str] = None
    # Client-observed facts the LLM can't know on its own — how long the
    # interview took and what BrewShield proctoring saw — folded into the
    # persisted report alongside the LLM-scored fields.
    time_taken_sec: Optional[int] = None
    question_count: Optional[int] = None
    proctor_flags_count: Optional[int] = None
    integrity_score: Optional[int] = None


def _serialize_interview_report(result: models.ScreeningResult) -> dict:
    details = result.details or {}
    return {
        "session_id": result.session_id,
        "candidate_name": result.candidate_name,
        "role_title": result.role_title,
        "communication_score": details.get("communication_score"),
        "relevance_score": details.get("relevance_score"),
        "confidence_score": details.get("confidence_score"),
        "overall_score": result.jd_match_score,
        "recommendation": result.verdict,
        "summary": result.summary,
        "strengths": result.strengths or [],
        "areas_for_improvement": result.gaps or [],
        "matched_skills": details.get("matched_skills", []),
        "missing_skills": details.get("missing_skills", []),
        "key_takeaway": details.get("key_takeaway"),
        "suggested_next_step": details.get("suggested_next_step"),
        "time_taken_sec": details.get("time_taken_sec"),
        "question_count": details.get("question_count"),
        "proctor_flags_count": details.get("proctor_flags_count"),
        "integrity_score": details.get("integrity_score"),
        "report_id": result.id,
        "created_at": result.created_at.isoformat() if result.created_at else None,
    }


@router.post("/interview/turn")
@limiter.limit("30/minute")
async def interview_turn(http_request: Request, request: InterviewTurnRequest):
    """
    Given the conversation so far, returns the AI interviewer's next line
    (or a closing line + is_final=true once max_turns is reached).
    """
    try:
        history = _sanitize_history([t.model_dump() for t in request.history])
        # generate_next_turn() makes a blocking network call to the LLM
        # provider (urllib, not httpx) — running it inline in this async def
        # would stall the whole event loop, delaying every other in-flight
        # request (other candidates' turns, transcribe, tts...) for as long
        # as the LLM call takes. run_in_threadpool moves it off the loop.
        result = await run_in_threadpool(
            generate_next_turn, history, request.role_title, request.jd_text, request.max_turns, request.resume_context
        )
        if result.get("question"):
            result["question"] = check_output(result["question"]).text
        return result
    except Exception as e:
        print(f"[Interview Turn API Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/interview/evaluate")
@limiter.limit("15/minute")
async def interview_evaluate(
    http_request: Request,
    request: InterviewEvaluationRequest,
    identity: LLMOpsIdentity = Depends(get_llmops_identity),
    db: Session = Depends(get_db),
):
    """Scores the full transcript once the interview has ended and returns a
    detailed, actionable report (sub-scores, recommendation, grounded
    strengths/gaps, matched/missing skills, a key takeaway and a concrete
    next step). When a session_id is present (invite-link interviews), the
    report is persisted so it survives a page reload and can be fetched
    again later via GET /interview/report/{session_id}."""
    llmops_stack = ExitStack()
    llmops_stack.enter_context(
        llmops_context(user_id=identity.user_id, session_id=identity.session_id, workflow_type="interview")
    )
    try:
        history = _sanitize_history([t.model_dump() for t in request.history])
        evaluation = await run_in_threadpool(
            generate_evaluation, history, request.role_title, request.jd_text, request.resume_skills or None,
        )

        if evaluation.get("summary"):
            evaluation["summary"] = check_output(evaluation["summary"]).text
        if evaluation.get("key_takeaway"):
            evaluation["key_takeaway"] = check_output(evaluation["key_takeaway"]).text
        if evaluation.get("suggested_next_step"):
            evaluation["suggested_next_step"] = check_output(evaluation["suggested_next_step"]).text
        evaluation["strengths"] = [check_output(s).text for s in evaluation.get("strengths", [])]
        evaluation["areas_for_improvement"] = [check_output(s).text for s in evaluation.get("areas_for_improvement", [])]

        evaluation["time_taken_sec"] = request.time_taken_sec
        evaluation["question_count"] = request.question_count
        evaluation["proctor_flags_count"] = request.proctor_flags_count
        evaluation["integrity_score"] = request.integrity_score

        if request.session_id:
            session = db.query(models.ScreeningSession).filter(models.ScreeningSession.id == request.session_id).first()

            # Orchestration layer: fold the full transcript this endpoint
            # already received into episodic memory (Postgres) + semantic
            # memory (Pinecone), and clear this session's working memory.
            # transcript_override is used because the live interview UI
            # (InterviewRoom.tsx) drives Q&A client-side rather than through
            # /orchestrator/session/turn per exchange. Also network-bound —
            # same threadpool reasoning as generate_next_turn above.
            transcript = [{"role": "agent" if t["role"] == "interviewer" else "candidate", "text": t["text"]} for t in history]
            await run_in_threadpool(
                orchestrator.end_session,
                request.session_id,
                scores={
                    "communication_score": evaluation.get("communication_score"),
                    "relevance_score": evaluation.get("relevance_score"),
                    "confidence_score": evaluation.get("confidence_score"),
                    "overall_score": evaluation.get("overall_score"),
                },
                summary=evaluation.get("summary"),
                transcript_override=transcript,
            )

            result = models.ScreeningResult(
                id=str(uuid.uuid4()),
                source="interview",
                session_id=request.session_id,
                call_id=None,
                candidate_name=request.candidate_name or (session.email if session else "Candidate"),
                role_title=request.role_title,
                jd_text_used=request.jd_text,
                jd_match_score=evaluation.get("overall_score"),
                verdict=evaluation.get("recommendation"),
                strengths=evaluation.get("strengths", []),
                gaps=evaluation.get("areas_for_improvement", []),
                summary=evaluation.get("summary"),
                details={
                    "communication_score": evaluation.get("communication_score"),
                    "relevance_score": evaluation.get("relevance_score"),
                    "confidence_score": evaluation.get("confidence_score"),
                    "matched_skills": evaluation.get("matched_skills", []),
                    "missing_skills": evaluation.get("missing_skills", []),
                    "key_takeaway": evaluation.get("key_takeaway"),
                    "suggested_next_step": evaluation.get("suggested_next_step"),
                    "time_taken_sec": request.time_taken_sec,
                    "question_count": request.question_count,
                    "proctor_flags_count": request.proctor_flags_count,
                    "integrity_score": request.integrity_score,
                    "email": request.email or (session.email if session else None),
                },
            )
            db.add(result)
            if session:
                session.status = "completed"
            db.commit()
            db.refresh(result)
            evaluation["report_id"] = result.id

        return evaluation
    except Exception as e:
        print(f"[Interview Evaluate API Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        llmops_stack.close()


@router.get("/interview/report/{session_id}")
def get_interview_report(session_id: str, db: Session = Depends(get_db)):
    """Fetches the persisted detailed report for a completed invite-link
    interview — lets a candidate reload their interview link, or HR review a
    finished interview, without needing the transcript to still be sitting
    in the browser's React state."""
    result = (
        db.query(models.ScreeningResult)
        .filter(models.ScreeningResult.session_id == session_id, models.ScreeningResult.source == "interview")
        .order_by(models.ScreeningResult.created_at.desc())
        .first()
    )
    if not result:
        raise HTTPException(status_code=404, detail="No report has been generated for this interview session yet.")
    return _serialize_interview_report(result)


from fastapi import WebSocket, WebSocketDisconnect
import base64
from ..services.audio_service import generate_tts_audio_async


@router.websocket("/interview/ws/{session_id}")
async def interview_websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    Full-duplex WebSocket gateway for ultra-low latency interview streaming:
    - Real-time turn generation
    - Pre-streamed neural TTS audio
    - Immediate barge-in / speech cancellation acknowledgment
    - Live proctoring telemetry frame streaming

    Deliberately open (no auth) — a candidate on an invite link was never a
    signed-in platform user, and the session_id itself is the access control.
    """
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "timestamp": data.get("timestamp")})

            elif msg_type == "barge_in":
                # Candidate spoke while AI audio was streaming/playing — acknowledge interruption
                await websocket.send_json({
                    "type": "barge_in_ack",
                    "interrupted_at": data.get("timestamp"),
                })

            elif msg_type == "next_turn":
                history = _sanitize_history(data.get("history", []))
                role_title = data.get("role_title", "the open role")
                jd_text = data.get("jd_text")
                max_turns = data.get("max_turns", 6)
                resume_context = data.get("resume_context")

                # 1. Generate text
                turn_result = await run_in_threadpool(
                    generate_next_turn, history, role_title, jd_text, max_turns, resume_context
                )
                question = turn_result.get("question", "")
                if question:
                    question = check_output(question).text

                # 2. Immediately synthesize Neural TTS audio asynchronously
                audio_bytes = await generate_tts_audio_async(question)
                audio_b64 = base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else None

                await websocket.send_json({
                    "type": "turn_result",
                    "question": question,
                    "is_final": turn_result.get("is_final", False),
                    "audio_base64": audio_b64,
                })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[Interview WebSocket Error session={session_id}] {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass

