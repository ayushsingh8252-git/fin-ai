import os
import uuid
from typing import List
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Document, Chunk, Rule
from ..worker import process_document_task, process_url_task
from ..services.canonicalization import delete_vectors_by_ids
from ..services.cache import flush_query_cache
from ..services.upload_safety import safe_filename, MAX_UPLOAD_BYTES

router = APIRouter()
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# BackgroundTasks runs its queued (sync) callables one at a time, in-process,
# after the response is sent — so uploading N files in one request used to
# process them strictly sequentially even though each document's ingestion
# is fully independent. Submitting to this shared pool instead lets multiple
# uploaded files actually ingest concurrently.
_ingestion_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="ingestion")

ALLOWED_EXTENSIONS = {".pdf", ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".webm", ".wma", ".md", ".txt"}


class UrlUploadRequest(BaseModel):
    url: str

@router.post("/upload")
async def upload_documents(files: List[UploadFile] = File(...), db: Session = Depends(get_db)):
    results = []
    
    for file in files:
        ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
        if ext not in ALLOWED_EXTENSIONS:
            results.append({"filename": file.filename, "status": "failed", "reason": f"Unsupported file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"})
            continue
            
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            results.append({
                "filename": file.filename, "status": "failed",
                "reason": f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)}MB upload limit.",
            })
            continue

        doc_id = str(uuid.uuid4())
        file_path = os.path.join(UPLOAD_DIR, f"{doc_id}_{safe_filename(file.filename)}")

        with open(file_path, "wb") as f:
            f.write(content)

        # Create DB record. Status starts "uploaded" (file saved, not yet
        # queued for parsing) so a GET /rules in the split-second before the
        # background thread flips it to "processing" reports something
        # truthful instead of the pre-existing default of "completed" — see
        # rules.py's status lookup. file_path is persisted so a later
        # /documents/{id}/reprocess call can re-run ingestion without the
        # caller needing to know the on-disk naming scheme.
        new_doc = Document(id=doc_id, name=file.filename, metadata_={"status": "uploaded", "file_path": file_path})
        db.add(new_doc)
        db.commit()
        db.refresh(new_doc)

        # Submitted to the shared ingestion pool (not BackgroundTasks) so
        # multiple files in this same upload batch process concurrently
        # instead of one blocking the next.
        _ingestion_executor.submit(process_document_task, doc_id, file_path)

        results.append({
            "document_id": doc_id,
            "filename": file.filename,
            "status": "uploaded"
        })
        
    return {"message": "Files uploaded successfully and are processing", "results": results}


@router.post("/upload-url")
async def upload_url(payload: UrlUploadRequest, db: Session = Depends(get_db)):
    url = payload.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    if not (url.startswith("http://") or url.startswith("https://")):
        url = f"https://{url}"

    doc_id = str(uuid.uuid4())
    new_doc = Document(
        id=doc_id,
        name=url,
        metadata_={"status": "processing", "source": "url", "source_url": url}
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)

    _ingestion_executor.submit(process_url_task, doc_id, url)

    return {
        "message": "URL queued for crawling and indexing",
        "document_id": doc_id,
        "url": url,
        "status": "processing"
    }


@router.post("/documents/{document_id}/reprocess")
async def reprocess_document(document_id: str, db: Session = Depends(get_db)):
    """
    Retries ingestion for a document stuck in "failed" (or any other) state.
    Idempotent: existing Chunk/Rule rows and their Pinecone vectors for this
    document_id are deleted first, so a retry re-indexes from scratch instead
    of piling duplicate vectors/rows on top of whatever partially landed
    before the original failure (see worker.py's _process_text_blocks —
    chunk/rule ids are freshly generated per run, so without this cleanup a
    second run would double-count everything indexed by the first).
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    meta = dict(doc.metadata_ or {})
    source = meta.get("source")

    # Verify the original source is actually re-ingestable BEFORE deleting
    # anything — a 400 here must leave the document's existing chunks/rules/
    # vectors untouched, not wipe them and then discover there's nothing to
    # rebuild them from.
    if source == "url":
        source_url = meta.get("source_url")
        if not source_url:
            raise HTTPException(status_code=400, detail="Original URL not recorded for this document; cannot reprocess.")
    else:
        file_path = meta.get("file_path")
        if not file_path or not os.path.exists(file_path):
            raise HTTPException(status_code=400, detail="Original uploaded file is no longer available on disk; please re-upload.")

    old_chunks = db.query(Chunk).filter(Chunk.document_id == document_id).all()
    old_rules = db.query(Rule).filter(Rule.document_id == document_id).all()
    vector_ids = [f"chunk_{c.id}" for c in old_chunks] + [f"rule_{r.id}" for r in old_rules]

    for c in old_chunks:
        db.delete(c)
    for r in old_rules:
        db.delete(r)
    db.commit()

    delete_vectors_by_ids(vector_ids)
    flush_query_cache()

    meta["status"] = "uploaded"
    meta.pop("error", None)
    doc.metadata_ = meta
    db.commit()

    if source == "url":
        _ingestion_executor.submit(process_url_task, document_id, meta.get("source_url"))
    else:
        _ingestion_executor.submit(process_document_task, document_id, meta.get("file_path"))

    return {"document_id": document_id, "status": "uploaded", "message": "Reprocessing started"}
