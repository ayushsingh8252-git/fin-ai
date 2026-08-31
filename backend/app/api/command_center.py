"""Command Center password unlock — the server-side alternative to the
existing voice-biometric gate (VoiceGateModal.tsx / api/voice.py). The
frontend never compares the password itself; it only POSTs here and reacts
to unlocked=True/False, so the actual credential check (and its hash) never
leaves this process.

Stateless by design, matching how voice unlock already behaves (no
token/cookie is minted on success — see VoiceGateModal.tsx's onAuthenticated,
which just flips local React state). This endpoint intentionally doesn't
reuse the Google-login User/session machinery in api/auth.py: Command Center
has never participated in that flow (ProductGate.tsx explicitly excludes it),
and the password here is a demo-scale, single-shared-secret gate, not a
per-user account system.
"""
import time
from typing import Dict, List

import bcrypt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..config import settings

router = APIRouter(prefix="/command-center", tags=["command-center"])

MAX_ATTEMPTS = 5
LOCKOUT_SECONDS = 15 * 60

# In-memory per-client-IP failed-attempt tracker. Fine for a single-process
# demo deployment (same scale assumption as the rest of this backend, e.g.
# key_manager's in-memory key rotation) — a multi-worker/multi-instance
# deployment would need this in Redis instead, since each worker would keep
# its own counter.
_failed_attempts: Dict[str, List[float]] = {}


class UnlockRequest(BaseModel):
    password: str


class UnlockResponse(BaseModel):
    unlocked: bool


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _prune(timestamps: List[float], now: float) -> List[float]:
    return [t for t in timestamps if now - t < LOCKOUT_SECONDS]


@router.post("/unlock", response_model=UnlockResponse)
def unlock(payload: UnlockRequest, request: Request):
    if not settings.COMMAND_CENTER_PASSWORD_HASH:
        raise HTTPException(
            status_code=503,
            detail="Password unlock isn't configured on this server (COMMAND_CENTER_PASSWORD_HASH unset).",
        )

    key = _client_key(request)
    now = time.time()
    attempts = _prune(_failed_attempts.get(key, []), now)

    if len(attempts) >= MAX_ATTEMPTS:
        retry_after = max(int(LOCKOUT_SECONDS - (now - attempts[0])), 1)
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {retry_after}s.",
        )

    password = payload.password or ""
    matched = False
    if password:
        try:
            matched = bcrypt.checkpw(
                password.encode("utf-8"),
                settings.COMMAND_CENTER_PASSWORD_HASH.encode("utf-8"),
            )
        except ValueError:
            # Malformed hash in settings — never let this look like a match.
            matched = False

    if not matched:
        attempts.append(now)
        _failed_attempts[key] = attempts
        raise HTTPException(status_code=401, detail="Incorrect password.")

    _failed_attempts.pop(key, None)
    return UnlockResponse(unlocked=True)
