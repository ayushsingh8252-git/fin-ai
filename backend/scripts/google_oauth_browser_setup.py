"""Browser-based one-time setup for the Google Workspace MCP connectors —
alternative to google_oauth_device_setup.py's device-code flow.

Use this if the device-code flow (scripts/google_oauth_device_setup.py)
fails with `invalid_client` / `Invalid client type` even though the OAuth
client really is a "Desktop app" type in Google Cloud Console — this can
happen for a client created only minutes ago, since the device-authorization
endpoint (oauth2.googleapis.com/device/code) appears to propagate new
clients more slowly than the standard authorize/token endpoints. This
script uses the same standard authorization-code + loopback-redirect flow
"Sign in with Google" apps use everywhere, which isn't affected by that
same lag.

Requires no redirect URI to be pre-registered in Google Cloud Console — a
"Desktop app" (installed application) OAuth client is automatically
allowed to redirect to any http://127.0.0.1:<port>/... loopback address.

Usage:
  cd backend && python scripts/google_oauth_browser_setup.py

On success, writes GOOGLE_OAUTH_REFRESH_TOKEN straight into .env — just
restart the backend afterward, exactly like the device-code script.
"""
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests  # noqa: E402

from app.config import settings  # noqa: E402
from app.services.env_persist import persist_env_var  # noqa: E402

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"

# Same union of scopes as the device-code script.
SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
]

_result: dict = {}


class _CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        params = parse_qs(urlparse(self.path).query)
        if "code" in params:
            _result["code"] = params["code"][0]
            body = b"<html><body>Authorized. You can close this tab and return to the terminal.</body></html>"
        else:
            _result["error"] = params.get("error", ["unknown_error"])[0]
            body = b"<html><body>Authorization failed. Check the terminal.</body></html>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # silence default request logging
        pass


def main() -> int:
    client_id = settings.GOOGLE_OAUTH_CLIENT_ID
    client_secret = settings.GOOGLE_OAUTH_CLIENT_SECRET
    if not client_id or not client_secret:
        print("Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in .env.")
        return 1

    server = HTTPServer(("127.0.0.1", 0), _CallbackHandler)
    port = server.server_address[1]
    redirect_uri = f"http://127.0.0.1:{port}/callback"

    auth_params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
    }
    auth_url = f"{AUTH_URL}?{urlencode(auth_params)}"

    print()
    print("=" * 60)
    print("Open this URL in your browser (or it may open automatically):")
    print()
    print(auth_url)
    print()
    print("Sign in with your personal Gmail account and approve access.")
    print("=" * 60)
    print()

    try:
        webbrowser.open(auth_url)
    except Exception:
        pass

    print("Waiting for authorization (listening on", redirect_uri, ")...")
    server.timeout = 300
    server.handle_request()  # blocks for exactly one request, then returns

    if "error" in _result:
        print(f"Authorization failed: {_result['error']}")
        return 1
    if "code" not in _result:
        print("Timed out waiting for authorization.")
        return 1

    token_resp = requests.post(
        TOKEN_URL,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": _result["code"],
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        },
        timeout=15,
    )
    if token_resp.status_code >= 400:
        print(f"Token exchange failed ({token_resp.status_code}):")
        print(token_resp.text)
        return 1

    body = token_resp.json()
    refresh_token = body.get("refresh_token")
    if not refresh_token:
        print("Authorized, but Google didn't return a refresh_token.")
        print("This usually means this account already authorized this client before —")
        print("revoke access at https://myaccount.google.com/permissions and re-run this script.")
        return 1

    persist_env_var("GOOGLE_OAUTH_REFRESH_TOKEN", refresh_token)
    print()
    print("Success! GOOGLE_OAUTH_REFRESH_TOKEN written to .env — restart the backend to pick it up.")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
