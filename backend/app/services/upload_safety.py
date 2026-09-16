"""Shared filename/size safety for every file-upload endpoint. Previously each
of upload.py, fraud.py, hiring.py, telephonic.py built its storage path from
the raw client-supplied `file.filename` (e.g. `f"{uuid}_{file.filename}"`) —
a filename containing `../` segments isn't neutralized by the uuid prefix,
since os.path.join/normpath still resolves the traversal past it. None of
them capped upload size either (only nginx's client_max_body_size, which
doesn't apply when a backend port is reached directly).
"""
import os

from fastapi import HTTPException

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25MB, matches nginx/policy.conf's client_max_body_size


def safe_filename(filename: str) -> str:
    """Strips any directory component a client-supplied filename might carry,
    so it's always safe to use as the tail end of an os.path.join. Falls back
    to a fixed name if that leaves nothing usable (e.g. filename was "../" or
    empty)."""
    name = os.path.basename((filename or "").replace("\\", "/"))
    name = name.lstrip(".").strip()
    return name or "upload"


def enforce_upload_size(content: bytes) -> None:
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)}MB upload limit.",
        )
