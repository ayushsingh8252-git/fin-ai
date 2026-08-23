import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client
from twilio.twiml.voice_response import Gather, VoiceResponse

from .. import models
from ..config import settings
from ..database import get_db
from ..memory import global_memory, orchestrator
from ..services.telephonic_service import generate_call_evaluation, generate_call_turn
from ..services.resilience import call_with_resilience, CircuitOpenError
from ..services.guardrails import check_input, check_output

router = APIRouter(prefix="/telephonic", tags=["telephonic"])

MAX_TURNS = 4
GATHER_TIMEOUT_SEC = 10
MAX_CONSECUTIVE_MISSES = 2
LOW_CONFIDENCE_THRESHOLD = 0.5


def _twilio_client() -> Client:
    if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_PHONE_NUMBER):
        raise HTTPException(
            status_code=503,
            detail="Twilio isn't configured on the backend (missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER).",
        )
    return Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)


def _serialize(record: models.CallRecord) -> dict:
    return {
        "id": record.id,
        "call_sid": record.call_sid,
        "to_number": record.to_number,
        "candidate_name": record.candidate_name,
        "role_title": record.role_title,
        "status": record.status,
        "transcript": record.transcript or [],
        "duration_sec": record.duration_sec,
        "error_message": record.error_message,
        "communication_score": record.communication_score,
        "relevance_score": record.relevance_score,
        "confidence_score": record.confidence_score,
        "evaluation_summary": record.evaluation_summary,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


class PlaceCallRequest(BaseModel):
    to: str
    candidate_name: str = "there"
    role_title: str = "the open role"


@router.post("/call")
def place_call(payload: PlaceCallRequest, db: Session = Depends(get_db)):
    if not settings.PUBLIC_BASE_URL:
        raise HTTPException(
            status_code=503,
            detail=(
                "PUBLIC_BASE_URL isn't set — Twilio needs a public HTTPS URL to fetch call "
                "instructions from. Set it to an ngrok URL (dev) or this backend's deployed URL."
            ),
        )
    client = _twilio_client()

    # Shared/global memory: same convention as api/screening.py — every real
    # call that names a role grows the Role table from actual usage.
    global_memory.upsert_role((payload.role_title or "the open role").strip())

    record = models.CallRecord(
        id=str(uuid.uuid4()),
        to_number=payload.to,
        candidate_name=payload.candidate_name or "there",
        role_title=payload.role_title or "the open role",
        status="queued",
        transcript=[],
    )
    db.add(record)
    db.commit()

    base = settings.PUBLIC_BASE_URL.rstrip("/")
    voice_url = f"{base}/api/v1/telephonic/voice?call_record_id={record.id}"
    status_url = f"{base}/api/v1/telephonic/status?call_record_id={record.id}"

    def _create_call():
        # Twilio trial accounts reject the request outright ("limited parameter
        # access") the moment an explicit method/status_callback_method or a
        # status_callback_event list is included — even though POST is already
        # the default for both. Passing only `url` + `status_callback` (both
        # POST by default, fires on completion) is the trial-safe shape; the
        # same call works unmodified once the account is upgraded.
        return client.calls.create(
            to=payload.to,
            from_=settings.TWILIO_PHONE_NUMBER,
            url=voice_url,
            status_callback=status_url,
        )

    try:
        # Circuit breaker + exponential backoff (services/resilience.py) —
        # retries only transient network failures talking to Twilio;
        # TwilioRestException (an actual rejection, e.g. trial-account
        # restrictions) is marked non_retryable since retrying it can't help.
        # The breaker itself opens after repeated failures of either kind so
        # a dead Twilio config/outage fails fast instead of being retried on
        # every single call-placement request.
        call = call_with_resilience(
            "twilio", _create_call,
            max_attempts=3, base_delay=0.4, max_delay=3.0,
            non_retryable=(TwilioRestException,),
        )
    except TwilioRestException as e:
        record.status = "failed"
        record.error_message = e.msg
        db.commit()
        raise HTTPException(status_code=502, detail=f"Twilio rejected the call: {e.msg}")
    except CircuitOpenError as e:
        record.status = "failed"
        record.error_message = str(e)
        db.commit()
        raise HTTPException(status_code=502, detail=f"Twilio is currently unavailable, please try again shortly: {e}")
    except Exception as e:
        # Network-level failure talking to Twilio (timeout, connection reset) —
        # not a Twilio rejection, but the candidate still doesn't get called,
        # so treat it the same way rather than leaking a raw 500.
        record.status = "failed"
        record.error_message = str(e)
        db.commit()
        raise HTTPException(status_code=502, detail=f"Could not reach Twilio: {e}")

    record.call_sid = call.sid
    record.status = call.status or "queued"
    db.commit()
    return _serialize(record)


@router.get("/calls")
def list_calls(db: Session = Depends(get_db)):
    records = db.query(models.CallRecord).order_by(models.CallRecord.created_at.desc()).limit(50).all()
    return [_serialize(r) for r in records]


@router.get("/calls/{call_id}")
def get_call(call_id: str, db: Session = Depends(get_db)):
    record = db.query(models.CallRecord).filter(models.CallRecord.id == call_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Call not found")
    return _serialize(record)


def _gather_twiml(record: models.CallRecord, say_text: str, misses: int = 0) -> str:
    """Builds the TwiML for one turn: speak `say_text`, then listen for the
    candidate's spoken reply and post it to /gather. If nothing is heard,
    Twilio still posts to `action` with an empty SpeechResult, which /gather
    treats as "didn't catch that" rather than silently hanging up.

    `misses` carries the consecutive-empty/low-confidence-result count through
    to the next /gather webhook via the action URL, since call state isn't
    otherwise threaded between requests beyond the DB-backed CallRecord."""
    base = settings.PUBLIC_BASE_URL.rstrip("/")
    vr = VoiceResponse()
    # Domain vocabulary Twilio's speech recognizer should be biased toward —
    # only include values that are actually known for this call.
    hint_terms = [t for t in (record.role_title, record.candidate_name, "AgenticFlow") if t]
    gather = Gather(
        input="speech",
        action=f"{base}/api/v1/telephonic/gather?call_record_id={record.id}&misses={misses}",
        method="POST",
        speech_timeout="auto",
        timeout=GATHER_TIMEOUT_SEC,
        # "phone_call" is Twilio's speech model tuned for 8kHz telephony audio
        # (vs. the generic default), which materially improves ASR accuracy here.
        speech_model="phone_call",
        language="en-US",
        hints=", ".join(hint_terms) if hint_terms else None,
    )
    gather.say(say_text)
    vr.append(gather)
    # Reached only if Gather's own action request itself never fires (rare) —
    # keeps the call from hanging silently instead of ending cleanly.
    vr.say("We'll follow up by email. Goodbye for now.")
    vr.hangup()
    return str(vr)


@router.post("/voice")
async def voice_webhook(call_record_id: str, db: Session = Depends(get_db)):
    """Twilio hits this the moment the candidate picks up."""
    record = db.query(models.CallRecord).filter(models.CallRecord.id == call_record_id).first()
    if not record:
        vr = VoiceResponse()
        vr.say("Sorry, something went wrong on our end. Goodbye.")
        vr.hangup()
        return Response(content=str(vr), media_type="application/xml")

    record.status = "in-progress"
    turn = generate_call_turn([], record.candidate_name, record.role_title, MAX_TURNS)
    turn["question"] = check_output(turn["question"]).text
    record.transcript = [{"role": "agent", "text": turn["question"]}]
    db.commit()

    # Orchestration layer: opens this call's working-memory session (Redis) so
    # the live question/transcript/sentiment are tracked from the first line,
    # and registers the candidate<->role relationship in graph memory.
    orchestrator.start_session("telephonic", record.to_number, record.role_title, session_id=record.id)
    orchestrator.record_turn(record.id, question=turn["question"])

    return Response(content=_gather_twiml(record, turn["question"]), media_type="application/xml")


@router.post("/gather")
async def gather_webhook(
    call_record_id: str,
    SpeechResult: Optional[str] = Form(None),
    Confidence: Optional[str] = Form(None),
    misses: int = 0,
    db: Session = Depends(get_db),
):
    """Twilio hits this after each Gather with what the candidate said."""
    record = db.query(models.CallRecord).filter(models.CallRecord.id == call_record_id).first()
    if not record:
        vr = VoiceResponse()
        vr.say("Sorry, something went wrong on our end. Goodbye.")
        vr.hangup()
        return Response(content=str(vr), media_type="application/xml")

    candidate_text = (SpeechResult or "").strip()
    if candidate_text:
        input_check = check_input(candidate_text)
        # Twilio's speech-to-text is low-risk as an injection vector, but
        # sanitize/cap it before it reaches the turn-generation prompt for
        # the same reason every other free-text entry point does — a
        # flagged transcript is treated like an unclear answer (re-ask)
        # rather than silently passed through.
        candidate_text = input_check.text if input_check.allowed else ""
    try:
        confidence = float(Confidence) if Confidence not in (None, "") else None
    except (TypeError, ValueError):
        confidence = None

    transcript = record.transcript or []
    low_confidence = bool(candidate_text) and confidence is not None and confidence < LOW_CONFIDENCE_THRESHOLD

    if not candidate_text or low_confidence:
        next_misses = misses + 1
        if next_misses >= MAX_CONSECUTIVE_MISSES:
            # Repeated empty/unclear results in a row — stop looping on the
            # same prompt and end the call gracefully instead.
            vr = VoiceResponse()
            vr.say("We're having a little trouble hearing you clearly. We'll follow up by email instead. Goodbye for now.")
            vr.hangup()
            record.status = "completed"
            db.commit()
            return Response(content=str(vr), media_type="application/xml")

        reask_text = (
            "Sorry, could you repeat that a bit more clearly?"
            if low_confidence
            else "Sorry, I didn't catch that — could you say that again?"
        )
        return Response(
            content=_gather_twiml(record, reask_text, misses=next_misses),
            media_type="application/xml",
        )

    transcript.append({"role": "candidate", "text": candidate_text, "confidence": confidence})

    turn = generate_call_turn(transcript, record.candidate_name, record.role_title, MAX_TURNS)
    turn["question"] = check_output(turn["question"]).text
    transcript.append({"role": "agent", "text": turn["question"]})
    record.transcript = transcript
    db.commit()

    # Orchestration layer: feed the candidate's answer (with the sentiment the
    # LLM just read off it) and the agent's next question into working memory.
    orchestrator.record_turn(record.id, answer=candidate_text, sentiment=turn.get("candidate_sentiment"))
    orchestrator.record_turn(record.id, question=turn["question"])

    if turn.get("is_final"):
        vr = VoiceResponse()
        vr.say(turn["question"])
        vr.hangup()
        record.status = "completed"
        db.commit()
        return Response(content=str(vr), media_type="application/xml")

    return Response(content=_gather_twiml(record, turn["question"]), media_type="application/xml")


@router.post("/status")
async def status_webhook(
    call_record_id: str,
    CallStatus: Optional[str] = Form(None),
    CallDuration: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Twilio's call-lifecycle callback (queued/ringing/answered/completed/...)."""
    record = db.query(models.CallRecord).filter(models.CallRecord.id == call_record_id).first()
    if record and CallStatus:
        # A completed webhook from /gather may already have set this more
        # precisely (e.g. after the final line) — don't downgrade it back to
        # Twilio's generic "completed" if we already know it finished cleanly.
        if not (record.status == "completed" and CallStatus == "completed"):
            record.status = CallStatus
        if CallDuration:
            try:
                record.duration_sec = int(CallDuration)
            except ValueError:
                pass

        # Score the call once Twilio confirms it's actually over — by this point
        # the transcript in the DB is final. Guarded on communication_score being
        # unset so a duplicate "completed" callback doesn't re-score for free.
        if CallStatus == "completed" and record.communication_score is None:
            transcript = record.transcript or []
            if any(t.get("role") == "candidate" for t in transcript):
                evaluation = generate_call_evaluation(transcript, record.role_title)
                record.communication_score = evaluation.get("communication_score")
                record.relevance_score = evaluation.get("relevance_score")
                record.confidence_score = evaluation.get("confidence_score")
                record.evaluation_summary = evaluation.get("summary")

        db.commit()

        # Orchestration layer: any terminal Twilio status ends this call's
        # working-memory session — folding it into episodic memory (Postgres)
        # and semantic memory (Pinecone), then clearing Redis — not just
        # "completed", so a no-answer/busy/failed call doesn't leak a
        # working-memory key that would otherwise just sit until its TTL.
        if CallStatus in ("completed", "no-answer", "busy", "failed", "canceled"):
            orchestrator.end_session(
                record.id,
                scores={
                    "communication_score": record.communication_score,
                    "relevance_score": record.relevance_score,
                    "confidence_score": record.confidence_score,
                },
                summary=record.evaluation_summary,
            )
    return Response(status_code=204)
