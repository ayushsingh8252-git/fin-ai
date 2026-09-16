"""Auth dependency shared by every protected route. Applied at the
`app.include_router(..., dependencies=[Depends(get_current_user)])` call site
in main.py for most routers (one line per router, no per-route edits), except
interview.py's WebSocket route, which can't use the header-based dependency
below (browsers can't set custom headers on a WS handshake) and uses
get_current_user_ws instead.
"""
import logging

import jwt
from fastapi import Depends, HTTPException, WebSocket, status
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


async def get_current_user_ws(websocket: WebSocket, token: str, db: Session) -> "models.User | None":
    """WebSocket variant — the JWT arrives as a `?token=` query param (not an
    Authorization header, which browsers cannot set on a WS handshake). Closes
    the socket with code 4401 and returns None on any auth failure; callers
    must check for None and stop instead of proceeding."""
    if not token:
        await websocket.close(code=4401, reason="Not authenticated.")
        return None
    try:
        claims = _decode_token(token)
    except HTTPException as exc:
        await websocket.close(code=4401, reason=str(exc.detail))
        return None
    user = db.query(models.User).filter(models.User.id == claims.get("sub")).first()
    if user is None:
        await websocket.close(code=4401, reason="User account no longer exists.")
        return None
    return user
