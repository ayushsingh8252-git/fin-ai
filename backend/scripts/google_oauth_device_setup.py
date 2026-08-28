"""One-time setup for the Google Workspace MCP connectors (gmail, drive,
calendar, docs, sheets) when the target is a personal Google account rather
than a Google Workspace domain — see app/mcp/connectors/google/_auth.py for
why domain-wide delegation (service accounts) doesn't apply there.

Uses OAuth 2.0's device-code flow: no redirect URI, no local web server, no
browser automation — just visit a URL on any device and type a short code.

Prerequisites (Google Cloud Console, same project as any existing service
account):
  1. APIs & Services > OAuth consent screen — configure it (External user
     type is fine for personal testing; add your own account as a test user
     if the app is in "Testing" publishing status).
  2. APIs & Services > Credentials > Create Credentials > OAuth client ID >
     Application type: "Desktop app". Copy the Client ID and Client Secret.
  3. Set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in .env to those
     values, then run this script:
       cd backend && python scripts/google_oauth_device_setup.py

On success, writes GOOGLE_OAUTH_REFRESH_TOKEN straight into .env — just
restart the backend afterward. The Google Workspace connectors will then use
this refresh token instead of the service-account path automatically (see
_auth.py's get_access_token — OAuth mode is preferred whenever configured).
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests  # noqa: E402

from app.config import settings  # noqa: E402
from app.services.env_persist import persist_env_var  # noqa: E402

DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code"
TOKEN_URL = "https://oauth2.googleapis.com/token"
DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"

# Union of every scope the 5 Google Workspace connectors declare.
SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
]


def main() -> int:
    client_id = settings.GOOGLE_OAUTH_CLIENT_ID
    client_secret = settings.GOOGLE_OAUTH_CLIENT_SECRET
    if not client_id or not client_secret:
        print("Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in .env.")
        print("Create a Desktop-app OAuth client ID in Google Cloud Console first — see this file's docstring.")
        return 1

    print("Requesting a device code from Google...")
    resp = requests.post(DEVICE_CODE_URL, data={"client_id": client_id, "scope": " ".join(SCOPES)}, timeout=15)
    if resp.status_code >= 400:
        print(f"Google rejected the device-code request ({resp.status_code}):")
        print(resp.text)
        print()
        print("Common causes: the OAuth client ID isn't a 'Desktop app' type (device flow needs")
        print("Desktop app or TV/Limited-Input-Device type — Web application won't work), or the")
        print("client ID/secret don't match what's in Google Cloud Console.")
        return 1
    device = resp.json()

    print()
    print("=" * 60)
    print(f"  1. Open: {device['verification_url']}")
    print(f"  2. Enter this code: {device['user_code']}")
    print("  3. Sign in and grant access.")
    print("=" * 60)
    print()
    print("Waiting for authorization...")

    interval = device.get("interval", 5)
    deadline = time.time() + device.get("expires_in", 1800)

    while time.time() < deadline:
        time.sleep(interval)
        token_resp = requests.post(
            TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "device_code": device["device_code"],
                "grant_type": DEVICE_GRANT_TYPE,
            },
            timeout=15,
        )
        body = token_resp.json()

        if token_resp.status_code == 200:
            refresh_token = body.get("refresh_token")
            if not refresh_token:
                print("Authorized, but Google didn't return a refresh_token.")
                print("This usually means this account already authorized this client before — ")
                print("revoke access at https://myaccount.google.com/permissions and re-run this script.")
                return 1
            persist_env_var("GOOGLE_OAUTH_REFRESH_TOKEN", refresh_token)
            print()
            print("Success! GOOGLE_OAUTH_REFRESH_TOKEN written to .env — restart the backend to pick it up.")
            print()
            return 0

        error = body.get("error")
        if error == "authorization_pending":
            continue
        if error == "slow_down":
            interval += 5
            continue
        print(f"Authorization failed: {body}")
        return 1

    print("Timed out waiting for authorization.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
