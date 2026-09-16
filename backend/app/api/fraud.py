import asyncio
import json
import os
import uuid
import fitz
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from .. import models
from .deps import get_current_user, get_current_user_query
from ..database import get_db
from ..models import FraudScan
from ..rate_limit import limiter
from ..services.fraud_orchestrator import run_scan
from ..services.llmops import llmops_context
from ..services.llmops_identity import LLMOpsIdentity, get_llmops_identity
from ..services.upload_safety import safe_filename, enforce_upload_size

router = APIRouter(prefix="/fraud", tags=["fraud"])

UPLOAD_DIR = os.path.join("uploads", "fraud")
os.makedirs(UPLOAD_DIR, exist_ok=True)

EXT_CONTENT_TYPE = {".pdf": "pdf", ".jpg": "image", ".jpeg": "image", ".png": "image"}


def _render_pdf_preview(file_path: str, out_path: str) -> bool:
    """Renders page 1 to a PNG so the browser can show a real preview of the
    actual PDF content — <img> can't render a PDF directly, and pulling in
    pdfjs client-side just to show a thumbnail isn't worth the complexity."""
    try:
        doc = fitz.open(file_path)
        pix = doc[0].get_pixmap(dpi=150)
        pix.save(out_path)
        return True
    except Exception:
        return False


@router.post("/upload")
async def upload_fraud_document(file: UploadFile = File(...), db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    if ext not in EXT_CONTENT_TYPE:
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {', '.join(EXT_CONTENT_TYPE)}")

    scan_id = str(uuid.uuid4())
    saved_name = f"{scan_id}_{safe_filename(file.filename)}"
    file_path = os.path.join(UPLOAD_DIR, saved_name)

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    enforce_upload_size(content)
    with open(file_path, "wb") as f:
        f.write(content)

    content_type = EXT_CONTENT_TYPE[ext]
    scan = FraudScan(
        id=scan_id,
        filename=file.filename,
        file_path=file_path,
        content_type=content_type,
        status="uploaded",
        result={},
    )
    db.add(scan)
    db.commit()

    # preview_image_url always points to something an <img> tag can render —
    # the original for image uploads, a rendered first-page PNG for PDFs.
    if content_type == "pdf":
        preview_name = f"{scan_id}_preview.png"
        preview_image_url = f"/uploads/fraud/{preview_name}" if _render_pdf_preview(file_path, os.path.join(UPLOAD_DIR, preview_name)) else None
    else:
        preview_image_url = f"/uploads/fraud/{saved_name}"

    return {
        "scan_id": scan_id,
        "filename": file.filename,
        "content_type": content_type,
        "preview_url": f"/uploads/fraud/{saved_name}",
        "preview_image_url": preview_image_url,
    }


@router.get("/scan/{scan_id}/stream")
@limiter.limit("10/minute")
async def stream_scan(
    scan_id: str,
    request: Request,
    identity: LLMOpsIdentity = Depends(get_llmops_identity),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user_query),
):
    scan = db.query(FraudScan).filter(FraudScan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found.")

    file_path, content_type = scan.file_path, scan.content_type
    # Coarse, non-biometric signals for the Duplicate Identity Scan — only a
    # SHA-256 hash of these ever reaches storage (see fraud_identity.py), so
    # the raw IP/user-agent captured here is never persisted.
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    # The scan itself runs as an independent task on the event loop, not
    # inside the SSE generator directly — if the browser disconnects mid-scan
    # (tab close, refresh, network blip), Starlette tears down event_stream()
    # below, but this task keeps running and still persists a final
    # complete/error result. Previously the two were the same coroutine, so a
    # client disconnect threw GeneratorExit into run_scan mid-step and
    # silently orphaned the row in "scanning" forever — confirmed live: two
    # historical scans in the DB were stuck exactly this way with no
    # reconciliation job to clean them up.
    queue: asyncio.Queue = asyncio.Queue()

    async def _drive_scan():
        try:
            async for event in run_scan(scan_id, file_path, content_type, ip_address, user_agent):
                await queue.put(event)
        finally:
            await queue.put(None)

    # Entering llmops_context here (not inside _drive_scan) is intentional:
    # asyncio.create_task() snapshots the current contextvars into the new
    # task at creation time, so the tag applies for the task's whole
    # lifetime even though this "with" block itself exits immediately.
    with llmops_context(user_id=identity.user_id, session_id=identity.session_id, workflow_type="fraud"):
        asyncio.create_task(_drive_scan())

    async def event_stream():
        while True:
            event = await queue.get()
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/scan/{scan_id}")
def get_scan(scan_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    scan = db.query(FraudScan).filter(FraudScan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found.")
    return {
        "scan_id": scan.id,
        "filename": scan.filename,
        "content_type": scan.content_type,
        "status": scan.status,
        "result": scan.result,
    }


@router.post("/bundle")
def triangulate_bundle(payload: dict, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """
    Cross-triangulates a bundle of completed document scans.
    Payload: {"scan_ids": ["scan_id_1", "scan_id_2", ...]}
    """
    scan_ids = payload.get("scan_ids", [])
    if not scan_ids or not isinstance(scan_ids, list):
        raise HTTPException(status_code=400, detail="Must provide a list of 'scan_ids'.")

    scans = db.query(FraudScan).filter(FraudScan.id.in_(scan_ids)).all()
    if not scans:
        raise HTTPException(status_code=404, detail="No matching scans found for the provided scan_ids.")

    doc_results = []
    for s in scans:
        res = s.result or {}
        doc_results.append({
            "scan_id": s.id,
            "filename": s.filename,
            "content_type": s.content_type,
            "risk_score": res.get("risk_score"),
            "verdict": res.get("verdict"),
            "steps": res.get("steps", []),
        })

    from ..services.fraud_bundle_triangulation import triangulate_document_bundle
    bundle_analysis = triangulate_document_bundle(doc_results)
    return bundle_analysis

