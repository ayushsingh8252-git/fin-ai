"""Tiny shared helper for writing a single KEY=VALUE line back into the
repo's .env file — used by every path that mints GOOGLE_OAUTH_REFRESH_TOKEN
(the live /auth/google/callback endpoint, and the standalone
scripts/google_oauth_*_setup.py scripts) so all three leave the token in the
same place instead of each doing their own copy-paste-into-.env dance."""
import re
from pathlib import Path

# app/services/env_persist.py -> parents[2] is the AI-Policy-Rule-Engine app
# root, where the real .env lives (see config.py's env_file=("../.env", ".env")).
ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


def persist_env_var(key: str, value: str, path: Path = ENV_PATH) -> None:
    """Best-effort: replaces an existing `KEY=...` line in .env, or appends
    one if absent. Never raises — callers should already have updated the
    live in-process settings object, which is what matters for the running
    process; this only makes the value survive a restart."""
    try:
        text = path.read_text(encoding="utf-8") if path.exists() else ""
        line = f"{key}={value}"
        pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
        if pattern.search(text):
            text = pattern.sub(line, text, count=1)
        else:
            if text and not text.endswith("\n"):
                text += "\n"
            text += f"{line}\n"
        path.write_text(text, encoding="utf-8")
    except OSError:
        pass
