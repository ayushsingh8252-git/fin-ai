"""Auth dependency shared by every protected route. Applied at the
`app.include_router(..., dependencies=[Depends(get_current_user)])` call site
in main.py for most routers (one line per router, no per-route edits).

interview.py and screening.py are each handled per-route instead of via that
blanket dependency: both mix platform-user routes with candidate-facing
routes reached via an emailed invite link, where the candidate was never a
signed-in platform user — the long random session_id in the URL is that
flow's real access control, not this dependency. get_current_user_query below
exists for the one case that's neither a plain header check nor session-id-
scoped: fraud.py's SSE scan stream, which needs a real logged-in user but
can't use an Authorization header because browsers' EventSource API can't
set custom headers on any request.
"""
import logging

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .auth import JWT_ALGORITHM, _JWT_SIGNING_KEY
from ..database import get_db
from .. import models

logger = logging.getLogger(__name__)

_bearer_scheme = HTTPBearer(auto_error=False)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, _JWT_SIGNING_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired, please sign in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or malformed session token.")


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> "models.User":
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    claims = _decode_token(credentials.credentials)
    user = db.query(models.User).filter(models.User.id == claims.get("sub")).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User account no longer exists.")
    return user


def get_current_user_query(token: str, db: Session = Depends(get_db)) -> "models.User":
    """Same as get_current_user, but reads the JWT from a `?token=` query
    param instead of an Authorization header. Needed for fraud.py's SSE scan
    stream: browsers' EventSource API cannot set custom request headers at
    all, so the frontend already passes other per-request context (see
    llmops_identity) as query params for the same reason."""
    claims = _decode_token(token)
    user = db.query(models.User).filter(models.User.id == claims.get("sub")).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User account no longer exists.")
    return user
