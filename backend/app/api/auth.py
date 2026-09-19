import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
import requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from .. import models

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# Google's own tokeninfo endpoint validates the ID token's signature and
# expiry for us — good enough for a POC-scale login gate without pulling in
# google-auth just to re-verify a JWT locally (same "fastest POC stack"
# tradeoff used elsewhere in this backend).
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"

JWT_ALGORITHM = "HS256"

# Falls back to a random per-process key if JWT_SECRET_KEY isn't set (see
# config.py) rather than refusing to boot — matches this app's "empty =
# not configured, fail soft with a clear log line" convention used for every
# other integration. The tradeoff: every process restart invalidates all
# existing sessions when running on the generated key, so this must never be
# relied on outside local dev.
if settings.JWT_SECRET_KEY:
    _JWT_SIGNING_KEY = settings.JWT_SECRET_KEY
else:
    _JWT_SIGNING_KEY = secrets.token_hex(32)
    logger.warning(
        "[Auth] JWT_SECRET_KEY is not set — generated a random per-process key. "
        "All sessions will be invalidated on the next restart. Set JWT_SECRET_KEY "
        "in .env for any deployed environment."
    )


def create_access_token(user: "models.User") -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.id,
        "email": user.email,
        "iat": now,
        "exp": now + timedelta(days=settings.JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, _JWT_SIGNING_KEY, algorithm=JWT_ALGORITHM)


class GoogleLoginRequest(BaseModel):
    id_token: str


class AuthUserOut(BaseModel):
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None


class AuthResponse(BaseModel):
    user: AuthUserOut
    unique_user_count: int
    access_token: str


@router.post("/google", response_model=AuthResponse)
def google_login(payload: GoogleLoginRequest, db: Session = Depends(get_db)):
    try:
        resp = requests.get(
            GOOGLE_TOKENINFO_URL, params={"id_token": payload.id_token}, timeout=8
        )
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="Could not reach Google to verify the sign-in.")

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired Google sign-in token.")

    claims = resp.json()
    if settings.GOOGLE_CLIENT_ID and claims.get("aud") != settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=401, detail="Token was not issued for this app.")
    if claims.get("email_verified") not in ("true", True):
        raise HTTPException(status_code=401, detail="Google account email is not verified.")

    email = (claims.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="Google account has no email.")

    user = db.query(models.User).filter(models.User.email == email).first()
    now = datetime.now(timezone.utc)
    if user is None:
        user = models.User(
            id=str(uuid.uuid4()),
            email=email,
            name=claims.get("name"),
            picture=claims.get("picture"),
            login_count=1,
            last_login_at=now,
        )
        db.add(user)
    else:
        user.name = claims.get("name") or user.name
        user.picture = claims.get("picture") or user.picture
        user.login_count = (user.login_count or 0) + 1
        user.last_login_at = now

    # Seed the first hr_admin(s) from config (see Settings.HR_ADMIN_EMAILS).
    admin_emails = {e.strip().lower() for e in settings.HR_ADMIN_EMAILS.split(",") if e.strip()}
    if email in admin_emails and user.role != models.HR_ADMIN:
        user.role = models.HR_ADMIN
        logger.info("[Auth] %s promoted to hr_admin via HR_ADMIN_EMAILS", email)
    db.commit()

    unique_user_count = db.query(models.User).count()
    return AuthResponse(
        user=AuthUserOut(email=user.email, name=user.name, picture=user.picture),
        unique_user_count=unique_user_count,
        access_token=create_access_token(user),
    )


@router.get("/stats")
def auth_stats(db: Session = Depends(get_db)):
    """Lets a returning (already-signed-in-locally) visitor refresh the
    unique-tester count without forcing them through Google sign-in again."""
    return {"unique_user_count": db.query(models.User).count()}
