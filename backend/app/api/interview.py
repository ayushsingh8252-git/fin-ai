import os
import time
import uuid
from contextlib import ExitStack
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..database import SessionLocal, get_db
from ..memory import orchestrator
from ..rate_limit import limiter
from .deps import get_current_user
from ..services import interview_transcript
from ..services.interview_service import generate_evaluation, generate_next_turn, stream_next_turn
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
    session_id: Optional[str] = None


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
async def interview_turn(request: Request, payload: InterviewTurnRequest, db: Session = Depends(get_db)):
    """
    Given the conversation so far, returns the AI interviewer's next line
    (or a closing line + is_final=true once max_turns is reached). For an
    invite-link session, the server's own transcript is validated and
    extended (services/interview_transcript.py).
    """
    history = _sanitize_history([t.model_dump() for t in payload.history])
    if payload.session_id:
        session = db.get(models.ScreeningSession, payload.session_id)
        if session and session.status == "completed":
            raise HTTPException(status_code=409, detail="This interview has already been completed.")
        if session and session.transcript is not None:
            try:
                interview_transcript._merge(list(session.transcript), history)
            except interview_transcript.TranscriptMismatch as e:
                raise HTTPException(status_code=409, detail=str(e))
    try:
        # generate_next_turn() makes a blocking network call to the LLM
        # provider (urllib, not httpx) — running it inline in this async def
        # would stall the whole event loop, delaying every other in-flight
        # request (other candidates' turns, transcribe, tts...) for as long
        # as the LLM call takes. run_in_threadpool moves it off the loop.
        result = await run_in_threadpool(
            generate_next_turn, history, payload.role_title, payload.jd_text, payload.max_turns, payload.resume_context
        )
        if result.get("question"):
            result["question"] = check_output(result["question"]).text
        interview_transcript.record_turn(db, payload.session_id, history, result.get("question"))
        return result
    except Exception as e:
        print(f"[Interview Turn API Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/interview/evaluate")
@limiter.limit("15/minute")
async def interview_evaluate(
    request: Request,
    payload: InterviewEvaluationRequest,
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
        history = _sanitize_history([t.model_dump() for t in payload.history])
        transcript_verified = False
        if payload.session_id:
            existing = db.get(models.ScreeningSession, payload.session_id)
            if existing and existing.status == "completed":
                raise HTTPException(status_code=409, detail="This interview has already been evaluated.")
            try:
                history, transcript_verified = interview_transcript.transcript_for_evaluation(db, payload.session_id, history)
            except interview_transcript.TranscriptMismatch as e:
                raise HTTPException(status_code=409, detail=str(e))
        evaluation = await run_in_threadpool(
            generate_evaluation, history, payload.role_title, payload.jd_text, payload.resume_skills or None,
        )
        if payload.session_id and evaluation.pop("evaluation_unavailable", False):
            # Don't close an invite-link interview on a non-evaluation: the
            # transcript stays on the session and the candidate can resubmit.
            raise HTTPException(
                status_code=503,
                detail="The evaluation service is temporarily unavailable. Your answers are saved — please retry the submission.",
            )
        evaluation.pop("evaluation_unavailable", None)

        if evaluation.get("summary"):
            evaluation["summary"] = check_output(evaluation["summary"]).text
        if evaluation.get("key_takeaway"):
            evaluation["key_takeaway"] = check_output(evaluation["key_takeaway"]).text
        if evaluation.get("suggested_next_step"):
            evaluation["suggested_next_step"] = check_output(evaluation["suggested_next_step"]).text
        evaluation["strengths"] = [check_output(s).text for s in evaluation.get("strengths", [])]
        evaluation["areas_for_improvement"] = [check_output(s).text for s in evaluation.get("areas_for_improvement", [])]

        evaluation["time_taken_sec"] = payload.time_taken_sec
        evaluation["question_count"] = payload.question_count
        evaluation["proctor_flags_count"] = payload.proctor_flags_count
        evaluation["integrity_score"] = payload.integrity_score

        audio_integrity = None
        if payload.session_id:
            session = db.query(models.ScreeningSession).filter(models.ScreeningSession.id == payload.session_id).first()

            # Close the speaker-monitor stream first so its final events
            # (e.g. an unknown speaker still active) land before the report
            # snapshot. Deterministic audio facts only — never LLM input.
            from ..services import speaker_monitor, speaker_stream

            await speaker_stream.manager.stop(payload.session_id)
            audio = speaker_monitor.summarize(db, payload.session_id, session_completed=True)
            if audio["status"] != "not_enabled":
                counts: dict = {}
                for e in audio["events"]:
                    counts[e["event_type"]] = counts.get(e["event_type"], 0) + 1
                audio_integrity = {"status": audio["status"], "baseline_status": audio["baseline_status"],
                                   "stats": audio["stats"], "audio_context": audio["audio_context"], "event_counts": counts}

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
                payload.session_id,
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
                session_id=payload.session_id,
                call_id=None,
                candidate_name=payload.candidate_name or (session.email if session else "Candidate"),
                role_title=payload.role_title,
                jd_text_used=payload.jd_text,
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
                    "time_taken_sec": payload.time_taken_sec,
                    "question_count": payload.question_count,
                    "proctor_flags_count": payload.proctor_flags_count,
                    "integrity_score": payload.integrity_score,
                    "email": payload.email or (session.email if session else None),
                    # The conversation this report was scored on, and whether
                    # it's the server's own record (see interview_transcript).
                    "transcript": history,
                    "transcript_verified": transcript_verified,
                    "started_at": session.started_at.isoformat() if session and session.started_at else None,
                    "audio_integrity": audio_integrity,
                },
            )
            db.add(result)
            now = datetime.now(timezone.utc)
            if session:
                session.status = "completed"
                session.completed_at = now
                session.transcript = history
            # A Recruitment interview scheduled against this session is now
            # genuinely complete — the only place Interview.status leaves
            # "scheduled" for an AI interview.
            for iv in db.query(models.Interview).filter(models.Interview.screening_session_id == payload.session_id):
                iv.status = "completed"
                iv.completed_at = now
            db.commit()
            db.refresh(result)
            evaluation["report_id"] = result.id

        return evaluation
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Interview Evaluate API Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        llmops_stack.close()


@router.get("/interview/report/{session_id}")
def get_interview_report(session_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Persisted report for a completed invite-link interview — for HR.
    Requires sign-in: the scores and hire recommendation are an internal
    evaluation, not something the candidate's interview link should expose.
    (Recruitment's own report view is /recruitment/.../interviews/{id}/report.)"""
    from ..services import recruitment_service as rs
    rs.require_permission(user, rs.ACTION_VIEW)
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
from ..services import tts_service


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
    import asyncio
    import json
    from ..services import interview_live, speaker_stream

    streams = speaker_stream.manager
    async def _next_turn(data: dict) -> None:
        """Runs as its own task so the receive loop keeps reading the
        candidate's audio frames while the LLM + TTS work (5-15 s)."""
        history = _sanitize_history(data.get("history", []))
        role_title = data.get("role_title", "the open role")
        jd_text = data.get("jd_text")
        max_turns = data.get("max_turns", 6)
        resume_context = data.get("resume_context")

        # 0. Invite-link sessions: the server's own transcript must
        # agree with the client's history before a new question is
        # issued (services/interview_transcript.py).
        db = SessionLocal()
        try:
            session = db.get(models.ScreeningSession, session_id)
            if session and session.status == "completed":
                await websocket.send_json({"type": "error", "message": "This interview has already been completed."})
                return
            if session and session.transcript is not None:
                interview_transcript._merge(list(session.transcript), history)
        except interview_transcript.TranscriptMismatch as e:
            await websocket.send_json({"type": "error", "message": str(e)})
            return
        finally:
            db.close()

        if data.get("stream_llm"):
            turn_id = uuid.uuid4().hex[:12]
            task = asyncio.create_task(_streamed_turn(data, history, turn_id))
            tts_state["task"] = task
            # asyncio.wait, not await: barge-in cancels `task`, and that
            # must not propagate into (and kill) this turn task.
            await asyncio.wait({task})
            return

        # 1. Generate text
        turn_result = await run_in_threadpool(
            generate_next_turn, history, role_title, jd_text, max_turns, resume_context
        )
        question = turn_result.get("question", "")
        if question:
            question = check_output(question).text

        db = SessionLocal()
        try:
            interview_transcript.record_turn(db, session_id, history, question)
        finally:
            db.close()

        # 2. Send the text now, then stream the audio sentence by sentence
        # (tts_chunk ... tts_end) so playback starts after the first
        # sentence is synthesized rather than the whole question.
        # audio_base64 stays in the message (always null now) for older
        # clients, which then fetch POST /tts themselves.
        turn_id = uuid.uuid4().hex[:12]
        await websocket.send_json({
            "type": "turn_result",
            "question": question,
            "is_final": turn_result.get("is_final", False),
            "audio_base64": None,
            "audio_stream": bool(question),
            "turn_id": turn_id,
            # Deterministic speaker-monitor state at this turn (None if not monitored).
            "audio_context": streams.audio_context(session_id),
        })
        if not question:
            return
        tts_task = asyncio.create_task(_stream_tts(question, turn_id))
        tts_state["task"] = tts_task
        # asyncio.wait, not await: a barge-in cancels tts_task, and that
        # cancellation must not propagate into (and kill) this turn task.
        await asyncio.wait({tts_task})

    async def _streamed_turn(data: dict, history: list, turn_id: str) -> None:
        """LLM tokens -> sentences -> Kokoro -> WS, overlapped: the first
        sentence is spoken while the model is still writing the rest.

        Messages: turn_start -> tts_chunk{text,...}* -> turn_result (as soon
        as the LLM finishes, or with the partial text if interrupted first)
        -> tts_end. Barge-in cancels this task: the LLM stream is closed,
        queued sentences are dropped, and the transcript records exactly the
        text that was generated before the interruption (so the client's
        history — built from turn_result — still matches the server's)."""
        timings: dict = {"llm_start": time.perf_counter()}
        result: dict = {}
        state = {"finalized": False, "seq": -1}
        client_timing = data.get("client_timing") or {}

        async def finalize(texts: list, interrupted: bool) -> None:
            if state["finalized"]:
                return
            state["finalized"] = True
            question = " ".join(texts).strip()
            db = SessionLocal()
            try:
                interview_transcript.record_turn(db, session_id, history, question or None)
            except Exception as e:
                print(f"[Interview WebSocket] transcript record failed session={session_id}: {type(e).__name__}")
            finally:
                db.close()
            await websocket.send_json({
                "type": "turn_result",
                "question": question,
                "is_final": bool(result.get("is_final")) and not interrupted,
                "audio_base64": None,
                "audio_stream": True,
                "streamed": True,
                "interrupted": interrupted,
                "turn_id": turn_id,
                "audio_context": streams.audio_context(session_id),
            })

        await websocket.send_json({"type": "turn_start", "turn_id": turn_id})
        deltas = stream_next_turn(
            history, data.get("role_title", "the open role"), data.get("jd_text"),
            data.get("max_turns", 6), data.get("resume_context"), result=result, timings=timings,
        )
        outcome = "completed"
        try:
            async for spoken in tts_service.stream_speech_incremental(
                deltas, request_id=turn_id, timings=timings,
                sentence_filter=lambda s: check_output(s).text,
                on_text_complete=lambda texts: finalize(texts, interrupted=False),
            ):
                state["seq"] = spoken.chunk.seq
                await websocket.send_json({
                    "type": "tts_chunk",
                    "turn_id": turn_id,
                    "seq": spoken.chunk.seq,
                    "text": spoken.text,
                    "mime": spoken.chunk.media_type,
                    "duration_ms": spoken.chunk.duration_ms,
                    "audio_base64": base64.b64encode(spoken.chunk.audio).decode("ascii"),
                })
        except asyncio.CancelledError:
            outcome = "interrupted"
        except Exception as e:
            outcome = "error"
            print(f"[Interview WebSocket] streamed turn failed session={session_id} error={type(e).__name__}")
        try:
            await finalize(timings.get("texts", []), interrupted=outcome == "interrupted")
            end = {"type": "tts_end", "turn_id": turn_id, "chunks": state["seq"] + 1,
                   "interrupted": outcome == "interrupted"}
            if outcome == "error":
                end["error"] = "tts_unavailable"
            await websocket.send_json(end)
        except Exception:
            pass  # socket already gone

        def ms(key: str):
            v = timings.get(key)
            return round((v - timings["llm_start"]) * 1000) if v else None

        print(
            "[VOICE_LATENCY] "
            f"turn={turn_id} outcome={outcome} provider={timings.get('provider')} model={timings.get('model')} "
            f"stt_ms={client_timing.get('stt_ms')} since_speech_end_at_send_ms={client_timing.get('since_speech_end_ms')} "
            f"llm_ttft_ms={ms('llm_first_token')} first_sentence_ms={ms('first_sentence')} "
            f"kokoro_start_ms={ms('tts_start')} kokoro_first_audio_ms={ms('tts_first_audio')} "
            f"llm_done_ms={ms('llm_done')} full_response_ms={ms('tts_done')} sentences={len(timings.get('texts', []))}"
        )

    async def _stream_tts(text: str, turn_id: str) -> None:
        seq = -1
        try:
            async for chunk in tts_service.stream_speech(text, request_id=turn_id):
                seq = chunk.seq
                await websocket.send_json({
                    "type": "tts_chunk",
                    "turn_id": turn_id,
                    "seq": chunk.seq,
                    "mime": chunk.media_type,
                    "duration_ms": chunk.duration_ms,
                    "audio_base64": base64.b64encode(chunk.audio).decode("ascii"),
                })
            await websocket.send_json({"type": "tts_end", "turn_id": turn_id, "chunks": seq + 1, "interrupted": False})
        except asyncio.CancelledError:
            print(f"[TTS] interrupted id={turn_id} after_chunk={seq}")
            try:
                await websocket.send_json({"type": "tts_end", "turn_id": turn_id, "chunks": seq + 1, "interrupted": True})
            except Exception:
                pass
        except Exception as e:
            # Never surface provider internals to the candidate: the client
            # just sees the stream end and moves on to listening.
            print(f"[TTS] stream failed id={turn_id} error={type(e).__name__}: {e}")
            try:
                await websocket.send_json({"type": "tts_end", "turn_id": turn_id, "chunks": seq + 1, "error": "tts_unavailable"})
            except Exception:
                pass

    turn_lock = asyncio.Lock()
    turn_tasks: set = set()
    tts_state: dict = {"task": None}

    async def _run_turn(data: dict) -> None:
        async with turn_lock:  # turns stay strictly one at a time, in order
            try:
                await _next_turn(data)
            except Exception as e:
                print(f"[Interview WebSocket Error session={session_id}] {e}")
                try:
                    await websocket.send_json({"type": "error", "message": str(e)})
                except Exception:
                    pass

    interview_live.register(session_id, websocket, asyncio.get_running_loop())
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            # Binary frames = the candidate's mic audio (16 kHz int16 mono),
            # accepted only on the socket that started this session's stream.
            if message.get("bytes") is not None:
                if streams.owns(session_id, websocket):
                    await streams.feed(session_id, message["bytes"])
                continue
            try:
                data = json.loads(message.get("text") or "{}")
            except ValueError:
                continue
            msg_type = data.get("type", "")

            if msg_type == "audio_stream_start":
                if not data.get("consent"):
                    await websocket.send_json({"type": "audio_stream_status", "status": "rejected", "reason": "consent_required"})
                    continue
                ok, info = await streams.start(session_id, websocket)
                await websocket.send_json({"type": "audio_stream_status", "status": "started" if ok else "unavailable",
                                           **({"audio_session_id": info} if ok else {"reason": info})})
                continue

            if msg_type == "audio_phase":
                if streams.owns(session_id, websocket):
                    streams.set_phase(session_id, data.get("phase"), data.get("turn_index"))
                continue

            if msg_type == "audio_stream_stop":
                if streams.owns(session_id, websocket):
                    await streams.stop(session_id)
                continue

            if msg_type == "voice_metrics":
                # Browser-side measurements (it alone knows when audio really
                # started playing). Numbers only — no transcript content.
                def _num(k):
                    v = data.get(k)
                    return round(v) if isinstance(v, (int, float)) else None
                print(
                    f"[VOICE_LATENCY] browser turn={str(data.get('turn_id'))[:12]} "
                    f"candidate_stop_to_first_audio_ms={_num('candidate_stop_to_first_audio_ms')} "
                    f"stt_ms={_num('stt_ms')} next_turn_to_first_audio_ms={_num('next_turn_to_first_audio_ms')} "
                    f"full_response_ms={_num('full_response_ms')}"
                )
                continue

            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "timestamp": data.get("timestamp")})

            elif msg_type == "barge_in":
                # Candidate spoke while the interviewer was talking: stop
                # synthesizing the rest of the current question (the client
                # has already stopped playback and dropped queued chunks).
                task = tts_state["task"]
                cancelled = bool(task and not task.done())
                if cancelled:
                    task.cancel()
                await websocket.send_json({
                    "type": "barge_in_ack",
                    "interrupted_at": data.get("timestamp"),
                    "tts_cancelled": cancelled,
                })

            elif msg_type == "next_turn":
                task = asyncio.create_task(_run_turn(data))
                turn_tasks.add(task)
                task.add_done_callback(turn_tasks.discard)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[Interview WebSocket Error session={session_id}] {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        interview_live.unregister(session_id, websocket)
        if streams.owns(session_id, websocket):
            await streams.stop(session_id)


@router.get("/interview/{session_id}/audio-events")
def get_audio_events(session_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """HR-only (same gate as the interview report): the speaker monitor's
    measured stats and events for one interview. Returns status
    "not_enabled" when the candidate didn't consent. Never returns the
    candidate's voice embedding."""
    from ..services import recruitment_service as rs
    from ..services import speaker_monitor

    rs.require_permission(user, rs.ACTION_VIEW)
    session = db.get(models.ScreeningSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found.")
    return speaker_monitor.summarize(db, session_id, session_completed=session.status == "completed")


# ── OCEAN-AI behavioral analysis ─────────────────────────────────────────
# Opt-in: the candidate must explicitly check "Allow behavioral analysis"
# before InterviewRoom.tsx ever records or uploads anything here (see its
# consentRecordingEnabled state) — this backend has no way to verify that
# consent itself, same trust model as every other client-reported fact on
# this session (proctor_flags_count, time_taken_sec, ...), but the recording
# is never requested from the browser at all unless the box was checked.
RECORDING_UPLOAD_DIR = os.path.join("uploads", "interview_recordings")
os.makedirs(RECORDING_UPLOAD_DIR, exist_ok=True)
MAX_RECORDING_BYTES = 300 * 1024 * 1024  # ~300MB — generous for a several-minute webm at modest bitrate
ALLOWED_RECORDING_EXTENSIONS = {"video/webm": ".webm", "video/mp4": ".mp4", "video/x-matroska": ".mkv"}


def _resolve_candidate_and_interview(db: Session, session_id: str):
    """Best-effort: an AI interview taken via a bare invite link has no
    Recruitment-side Interview row at all, so both can legitimately stay
    None — mirrors the same optional join interview_evaluate already does
    above at `models.Interview.screening_session_id == payload.session_id`."""
    interview = (
        db.query(models.Interview)
        .filter(models.Interview.screening_session_id == session_id)
        .first()
    )
    return (interview.candidate_id if interview else None, interview.id if interview else None)


@router.post("/interview/{session_id}/recording")
@limiter.limit("5/minute")
async def upload_interview_recording(
    request: Request, session_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    """Receives the candidate's full-interview audio+video recording
    (continuous MediaRecorder capture, camera+mic, from InterviewRoom.tsx's
    opt-in consent flow) and queues OCEAN-AI behavioral analysis on it.

    Deliberately its own endpoint, not folded into /interview/evaluate:
    evaluate() must stay fast and must succeed even if the (much larger,
    slower-to-upload) recording never arrives — the interview's own
    completed/evaluated status never depends on this endpoint at all. Never
    logs the file path's contents or any request body — only the session_id,
    matching services/guardrails.py's no-PII-in-logs convention.
    """
    from ..config import settings

    # No ocean-service on this deployment: refuse instead of storing a
    # biometric recording that can never be analyzed.
    if not settings.OCEAN_SERVICE_URL:
        raise HTTPException(status_code=503, detail="Behavioral analysis is not enabled on this deployment.")

    session = db.get(models.ScreeningSession, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found.")

    ext = ALLOWED_RECORDING_EXTENSIONS.get(file.content_type)
    if ext is None:
        raise HTTPException(status_code=415, detail="Unsupported recording format — expected webm, mp4, or mkv.")

    dest_path = os.path.join(RECORDING_UPLOAD_DIR, f"{session_id}{ext}")
    size = 0
    try:
        with open(dest_path, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_RECORDING_BYTES:
                    raise HTTPException(status_code=413, detail="Recording exceeds the maximum allowed size.")
                out.write(chunk)
    except HTTPException:
        if os.path.exists(dest_path):
            os.remove(dest_path)
        raise
    if size == 0:
        if os.path.exists(dest_path):
            os.remove(dest_path)
        raise HTTPException(status_code=400, detail="Empty recording upload.")

    candidate_id, interview_id = _resolve_candidate_and_interview(db, session_id)

    row = (
        db.query(models.InterviewBehavioralAnalysis)
        .filter(models.InterviewBehavioralAnalysis.session_id == session_id)
        .first()
    )
    if not row:
        row = models.InterviewBehavioralAnalysis(id=str(uuid.uuid4()), session_id=session_id)
        db.add(row)
    row.recording_path = dest_path
    row.candidate_id = candidate_id
    row.interview_id = interview_id
    row.status = "pending"
    row.error_message = None
    row.audio_results = None
    row.video_results = None
    row.audio_video_results = None
    db.commit()

    try:
        from ..worker import analyze_candidate_ocean_task

        analyze_candidate_ocean_task.delay(session_id)
    except Exception as e:
        # Broker unreachable etc. — the recording itself is safely saved and
        # the row stays "pending"; the retry endpoint below re-dispatches
        # without needing another upload.
        print(f"[Behavioral Analysis Dispatch Warning] session={session_id} could not queue analysis: {e}")
        return {"status": "saved", "message": "Recording saved. Analysis could not be queued yet — it will be retried."}

    return {"status": "queued", "message": "Recording saved. Behavioral analysis has been queued."}


@router.get("/interview/{session_id}/behavioral-analysis")
def get_behavioral_analysis(session_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """HR-only (same gate as GET /interview/report/{session_id} above) —
    OCEAN-AI's output is a supplementary behavioral/personality signal for
    the hiring team, never shown to the candidate and never folded into
    jd_match_score/verdict (see ScreeningResult — nothing here writes to it).
    Returns status="not_requested" (not 404) when the candidate never opted
    into recording, since that is a legitimate, common, non-error state."""
    from ..services import recruitment_service as rs

    rs.require_permission(user, rs.ACTION_VIEW)
    row = (
        db.query(models.InterviewBehavioralAnalysis)
        .filter(models.InterviewBehavioralAnalysis.session_id == session_id)
        .first()
    )
    if not row:
        return {
            "status": "not_requested",
            "source": {"audio": False, "video": False, "fusion": False},
            "model": None,
            "results": None,
            "error": None,
            "processed_at": None,
        }
    return {
        "status": row.status,
        "source": {
            "audio": row.audio_results is not None,
            "video": row.video_results is not None,
            "fusion": row.audio_video_results is not None,
        },
        "model": {"name": row.model_name, "version": row.model_version} if row.model_name else None,
        # Never returned unless status is genuinely "completed" — no partial/
        # fake scores for pending/processing/failed states.
        "results": (
            {"audio": row.audio_results, "video": row.video_results, "audio_video": row.audio_video_results}
            if row.status == "completed"
            else None
        ),
        "error": row.error_message if row.status == "failed" else None,
        # SQLite drops tzinfo; the value was written as UTC, so say so —
        # otherwise the browser parses it as local time.
        "processed_at": (
            (row.processing_completed_at if row.processing_completed_at.tzinfo else row.processing_completed_at.replace(tzinfo=timezone.utc)).isoformat()
            if row.processing_completed_at
            else None
        ),
    }


@router.post("/interview/{session_id}/behavioral-analysis/retry")
def retry_behavioral_analysis(session_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Re-runs a failed (or stuck) analysis without requiring the candidate
    to re-upload anything — the recording file itself is untouched, only the
    row's status is reset and the Celery task re-dispatched. Requires
    ACTION_ANALYZE (not just ACTION_VIEW): triggering a multi-minute CPU job
    is an action, not a read, and an interviewer role (view-only) should not
    be able to kick it off."""
    from ..services import recruitment_service as rs

    rs.require_permission(user, rs.ACTION_ANALYZE)
    row = (
        db.query(models.InterviewBehavioralAnalysis)
        .filter(models.InterviewBehavioralAnalysis.session_id == session_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="No recording on file for this interview.")
    if row.status == "processing":
        raise HTTPException(status_code=409, detail="Analysis is already running.")

    row.status = "pending"
    row.error_message = None
    db.commit()

    from ..worker import analyze_candidate_ocean_task

    analyze_candidate_ocean_task.delay(session_id)
    return {"status": "queued"}

