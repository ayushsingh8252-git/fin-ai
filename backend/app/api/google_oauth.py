"""Browser-based Google OAuth2 flow for the Google Workspace MCP connectors
(Calendar, Gmail, Drive, Docs, Sheets — app/mcp/connectors/google/) — the
web-app counterpart to scripts/google_oauth_browser_setup.py's CLI flow.

Mounted directly on the app root (not under /api/v1) so its callback path
matches GOOGLE_AUTH_REDIRECT_URL in .env exactly:
  GET /auth/google/login     - redirects the browser to Google's consent screen
  GET /auth/google/callback  - exchanges the returned code for tokens

On success the refresh token is written into both the live `settings` object
(so the Calendar connector picks it up immediately, no restart needed) and
the .env file (so it survives one), via the same shared OAuth mode
(GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN in app/mcp/connectors/google/_auth.py)
the standalone setup scripts already use — this is just that same one-time
setup, done as a callback endpoint instead of a local CLI server.
"""
import secrets
from urllib.parse import urlencode

import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from ..config import settings
from ..mcp import registry
from ..services.env_persist import persist_env_var

router = APIRouter(prefix="/auth/google", tags=["google-oauth"])

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"

_STATE_COOKIE = "google_oauth_state"


def _workspace_scopes() -> list:
    """Union of every google_workspace connector's required_scopes (Calendar,
    Gmail, Drive, Docs, Sheets — see mcp/registry.py) — read from each
    connector's own declaration rather than duplicated here, so requesting
    "all of Workspace" via this one shared refresh token can never drift out
    of sync with what a connector actually needs (e.g. Calendar's
    check_availability needing calendar.events.freebusy on top of
    calendar.events)."""
    scopes: list = []
    for connector in registry.all_connectors():
        if connector.category != "google_workspace":
            continue
        for scope in connector.required_scopes:
            if scope not in scopes:
                scopes.append(scope)
    return scopes


@router.get("/login")
def google_login():
    """Kicks off the consent flow. Visit this URL in a browser (it needs a
    real user to click "Allow") — it's not meant to be called via fetch/XHR."""
    if not settings.GOOGLE_OAUTH_CLIENT_ID or not settings.GOOGLE_OAUTH_CLIENT_SECRET:
        raise HTTPException(
            status_code=503,
            detail="GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not configured.",
        )
    if not settings.GOOGLE_AUTH_REDIRECT_URL:
        raise HTTPException(status_code=503, detail="GOOGLE_AUTH_REDIRECT_URL is not configured.")

    state = secrets.token_urlsafe(24)
    auth_params = {
        "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_AUTH_REDIRECT_URL,
        "response_type": "code",
        "scope": " ".join(_workspace_scopes()),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    response = RedirectResponse(f"{AUTH_URL}?{urlencode(auth_params)}")
    response.set_cookie(_STATE_COOKIE, state, httponly=True, max_age=600, samesite="lax")
    return response


@router.get("/callback")
def google_callback(request: Request):
    error = request.query_params.get("error")
    if error:
        return HTMLResponse(f"<html><body>Google sign-in was cancelled or denied ({error}).</body></html>", status_code=400)

    code = request.query_params.get("code")
    state = request.query_params.get("state")
    if not code:
        raise HTTPException(status_code=400, detail="Missing 'code' from Google's callback.")

    expected_state = request.cookies.get(_STATE_COOKIE)
    if not expected_state or state != expected_state:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state — start again at /auth/google/login.")

    token_resp = requests.post(
        TOKEN_URL,
        data={
            "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
            "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": settings.GOOGLE_AUTH_REDIRECT_URL,
        },
        timeout=15,
    )
    if token_resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Google token exchange failed: {token_resp.text[:300]}")

    body = token_resp.json()
    refresh_token = body.get("refresh_token")
    if not refresh_token:
        return HTMLResponse(
            "<html><body>Authorized, but Google didn't return a refresh token — this account has likely "
            "already authorized this app before. Revoke access at "
            "<a href='https://myaccount.google.com/permissions'>myaccount.google.com/permissions</a> "
            "and try <a href='/auth/google/login'>/auth/google/login</a> again.</body></html>",
            status_code=200,
        )

    settings.GOOGLE_OAUTH_REFRESH_TOKEN = refresh_token
    persist_env_var("GOOGLE_OAUTH_REFRESH_TOKEN", refresh_token)

    response = HTMLResponse("<html><body>Google Workspace connected successfully. You can close this tab.</body></html>")
    response.delete_cookie(_STATE_COOKIE)
    return response
