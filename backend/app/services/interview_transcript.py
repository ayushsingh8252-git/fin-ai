"""Server-kept transcript for invite-link (ScreeningSession) interviews.

The interview UI runs the conversation from the browser, and used to send
the whole transcript to /interview/evaluate at the end — so whoever held the
link could submit any conversation, including interviewer questions the
server never asked, and have it scored and saved as the official report.

Now the server records each question it issues (screening/start's greeting,
then every /interview/turn result) and the candidate answers that arrive
with the next request. Evaluation scores this record. An incoming history
whose interviewer lines don't match what the server issued is rejected.
"""
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from .. import models

Turn = dict  # {"role": "interviewer" | "candidate", "text": str}


class TranscriptMismatch(Exception):
    """The client's history disagrees with what the server issued."""


def _norm(t: str) -> str:
    return " ".join((t or "").split())


def _interviewer_lines(turns: List[Turn]) -> List[str]:
    return [_norm(t.get("text", "")) for t in turns if t.get("role") == "interviewer"]


def _session(db: Session, session_id: Optional[str]) -> Optional[models.ScreeningSession]:
    if not session_id:
        return None
    return db.get(models.ScreeningSession, session_id)


def record_start(db: Session, session_id: Optional[str], greeting: Optional[str]) -> None:
    """Called by /screening/start. Starts (or restarts) the record with the
    server-issued greeting. A completed interview is never reopened."""
    s = _session(db, session_id)
    if not s or s.status == "completed" or not greeting:
        return
    s.transcript = [{"role": "interviewer", "text": greeting}]
    s.started_at = datetime.now(timezone.utc)
    s.status = "in_progress"
    db.commit()


def _merge(stored: List[Turn], history: List[Turn]) -> List[Turn]:
    """Validate `history` against `stored` and return the merged record:
    stored turns + any new candidate answers the client has added since.
    Raises TranscriptMismatch if an interviewer line differs or is extra."""
    issued = _interviewer_lines(stored)
    claimed = _interviewer_lines(history)
    if claimed[: len(issued)] != issued or len(claimed) > len(issued):
        raise TranscriptMismatch("The interview transcript doesn't match what the interviewer asked.")
    # Everything after the last issued question is the candidate's answer(s).
    last_q_index = max((i for i, t in enumerate(history) if t.get("role") == "interviewer"), default=-1)
    new_answers = [
        {"role": "candidate", "text": t.get("text", "")}
        for t in history[last_q_index + 1:]
        if t.get("role") == "candidate" and (t.get("text") or "").strip()
    ]
    # Candidate answers already stored before the last question stay as stored.
    stored_last_q = max((i for i, t in enumerate(stored) if t.get("role") == "interviewer"), default=-1)
    return list(stored[: stored_last_q + 1]) + new_answers


def record_turn(db: Session, session_id: Optional[str], history: List[Turn], question: Optional[str]) -> None:
    """Called after /interview/turn (HTTP or WebSocket) generated `question`
    for `history`. Appends the candidate's latest answer and the new question."""
    s = _session(db, session_id)
    if not s or s.status == "completed" or s.transcript is None:
        return
    merged = _merge(list(s.transcript), history)
    if question:
        merged.append({"role": "interviewer", "text": question})
    s.transcript = merged
    db.commit()


def transcript_for_evaluation(
    db: Session, session_id: Optional[str], history: List[Turn]
) -> Tuple[List[Turn], bool]:
    """Transcript to score, and whether it's the server-verified record.

    Sessions started under the server-kept flow return the stored record
    plus the final answer. Older sessions without a record fall back to the
    submitted history, flagged unverified so the report says so."""
    s = _session(db, session_id)
    if s is None or s.transcript is None:
        return history, False
    return _merge(list(s.transcript), history), True
