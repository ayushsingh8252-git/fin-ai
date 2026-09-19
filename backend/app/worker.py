import logging
import os
import random
from celery import Celery
from .config import settings

logger = logging.getLogger(__name__)

celery_app = Celery(
    "policy_worker",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_always_eager=False,
    # Conservative defaults for a single-worker POC (see docker-compose's
    # --pool=solo --concurrency=1 and the memory rationale next to it):
    # don't let one worker grab a pile of tasks it can't work on
    # concurrently anyway, and don't let a wedged task (a hung network call
    # not already covered by services/resilience.py's own timeouts) hold the
    # only worker slot forever. task_acks_late is deliberately NOT enabled
    # here — see NonRetryableIngestionError's docstring below for why.
    worker_prefetch_multiplier=1,
    task_soft_time_limit=780,   # 13 min — raises SoftTimeLimitExceeded inside the task, catchable below
    task_time_limit=900,        # 15 min — hard kill if the soft limit is ignored/uncatchable
    # Without this, a .delay() call from a FastAPI request against an
    # unreachable broker hangs on kombu's default connect retry instead of
    # failing fast — confirmed empirically (a bare redis://localhost:6379/0
    # with nothing listening took well over a minute to raise). That would
    # tie up the request thread far longer than the honest-error response
    # api/upload.py's _dispatch_ingestion is meant to give.
    broker_transport_options={"socket_connect_timeout": 5, "socket_timeout": 5},
    broker_connection_timeout=5,
    # Separate from the broker settings above: the redis *result backend*
    # (same URL, different client/connection) has its own reconnect-retry
    # policy, and Celery's default there is a much larger retry budget —
    # confirmed empirically: task.delay() against an unreachable Redis
    # eventually raised "Retry limit exceeded while trying to reconnect to
    # the Celery result store backend" after roughly 90+ seconds, not the
    # ~5s the broker_transport_options above would suggest. Capping it here
    # keeps _dispatch_ingestion's honest-failure path actually fast.
    result_backend_transport_options={"retry_policy": {"timeout": 5.0}},
)


class NonRetryableIngestionError(Exception):
    """Raised for ingestion failures retrying can't fix: unsupported/empty
    content, invalid audio, or the Document row no longer existing. Distinct
    from a plain Exception (assumed transient — Pinecone/LLM/network hiccups,
    the same category services/resilience.py already retries at the
    individual-call level) so the task-level retry below only fires for
    genuinely transient conditions, per the project's existing
    fail-honestly-not-fake convention (never silently converts a real
    failure into a fake success)."""


# Mirrors services/resilience.py's own backoff shape (exponential + jitter,
# capped) but as a literal here rather than importing that module's
# retry_with_backoff/call_with_resilience — those block the calling thread
# while sleeping, which is correct for retrying a single LLM/API call
# *inside* one task attempt (and several services already do exactly that
# internally), but wrong for a task-level retry: re-queuing via Celery's own
# countdown releases the worker slot while waiting, instead of a solo-pool
# worker sitting idle mid-sleep. Same backoff philosophy, right layer for
# a background job that can wait minutes, not milliseconds.
INGESTION_MAX_RETRIES = 3


def _ingestion_retry_countdown(attempt: int) -> float:
    base = min(300.0, 30.0 * (2 ** (attempt - 1)))  # 30s, 60s, 120s, capped at 5min
    return base + random.uniform(0, base * 0.25)


def _mark_status(db, document_id: str, **fields) -> None:
    """Small shared helper around the existing Document.metadata_ status
    convention (see api/upload.py) — not a new persistence mechanism, just
    avoids repeating the read-merge-write dict dance at every call site."""
    from .models import Document

    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        return
    meta = dict(doc.metadata_ or {})
    meta.update(fields)
    doc.metadata_ = meta
    db.commit()

def _process_text_blocks(document_id: str, blocks_data: list[dict], db) -> dict:
    """
    Shared tail of the ingestion pipeline: chunks raw text blocks, indexes them
    into Pinecone, and runs rule extraction. Used by both the PDF path and the
    URL-crawl path so they stay in sync instead of duplicating this logic.
    """
    from .services.chunking import chunk_document
    from .services.canonicalization import store_chunks_batch_in_pinecone, canonicalize_and_store_rule
    from .services.extraction import extract_rules_batch
    from .services.classification import classify_rule, DISCARD_LABELS
    from .services.validation import validate_rule
    from .models import Chunk, Document
    from concurrent.futures import ThreadPoolExecutor, as_completed

    MIN_RULE_CONFIDENCE = 70  # confidence is on a 0-100 scale (see canonicalization.py)

    chunks = chunk_document(document_id, blocks_data)
    print(f"Generated {len(chunks)} chunks for {document_id}")

    db_chunks = [
        Chunk(
            id=c["chunk_id"],
            document_id=c["document_id"],
            page=c["page"],
            section=c["section"],
            content=c["content"]
        )
        for c in chunks
    ]
    db.add_all(db_chunks)
    db.commit()

    BATCH_SIZE = 10
    # Bounded to 3 concurrent LLM batch calls — enough to meaningfully cut
    # ingestion wall time for larger documents, without hammering Groq/Gemini
    # rate limits (the old sequential loop's time.sleep(0.3) throttle is no
    # longer needed: concurrent workers naturally stagger their requests, and
    # generate_json_resilient's retry+circuit-breaker absorb the occasional
    # 429 this causes).
    RULE_EXTRACTION_WORKERS = 3

    with ThreadPoolExecutor(max_workers=2) as chunk_executor:
        chunk_indexing_future = chunk_executor.submit(store_chunks_batch_in_pinecone, chunks)

        valid_rules_count = 0
        batches = [chunks[i : i + BATCH_SIZE] for i in range(0, len(chunks), BATCH_SIZE)]

        with ThreadPoolExecutor(max_workers=RULE_EXTRACTION_WORKERS) as extraction_executor:
            future_to_batch = {
                extraction_executor.submit(extract_rules_batch, batch): batch for batch in batches
            }

            for future in as_completed(future_to_batch):
                batch = future_to_batch[future]
                try:
                    batch_results = future.result()
                except Exception as batch_err:
                    print(f"[Rule Extraction Warning] Batch failed, skipping: {batch_err}")
                    continue

                for res in batch_results:
                    chunk_idx = res.get("chunk_index")
                    if chunk_idx is not None and 0 <= chunk_idx < len(batch):
                        c = batch[chunk_idx]
                    else:
                        c = batch[0] if batch else {}

                    if not res.get("is_candidate", True):
                        continue

                    extracted = {
                        "key_finding": res.get("key_finding", c.get("content", "")[:200]),
                        "context": res.get("condition") or c.get("content", ""),
                        "actor": res.get("actor", "N/A"),
                        "action": res.get("action", "N/A"),
                        "type": res.get("type", "GUIDELINE"),
                        "confidence": res.get("confidence", 85)
                    }

                    # Quality gate 1: discard non-actionable statement types (facts,
                    # stories, examples, definitions) before they ever hit storage.
                    classification = classify_rule(extracted["key_finding"] or c.get("content", ""))
                    if classification.get("type") in DISCARD_LABELS:
                        continue

                    # Quality gate 2: minimum extraction confidence (0-100 scale).
                    if extracted["confidence"] < MIN_RULE_CONFIDENCE:
                        continue

                    # Quality gate 3: LLM cross-validation of the rule against its
                    # source text. Fail open (keep the rule) if the validator itself
                    # errors out (e.g. both LLM providers down) so an infra hiccup
                    # doesn't wipe out an entire ingestion batch.
                    try:
                        validation = validate_rule(c.get("content", ""), extracted)
                        if isinstance(validation, dict) and str(validation.get("status", "")).upper() == "INVALID":
                            continue
                    except Exception as validation_err:
                        print(f"[Rule Validation Warning] Skipping validation due to error: {validation_err}")

                    canonicalize_and_store_rule(
                        document_id=document_id,
                        page=c.get("page"),
                        section=c.get("section"),
                        rule_data=extracted,
                        db_session=db,
                        bbox=c.get("bbox"),
                        page_dim=c.get("page_dim")
                    )
                    valid_rules_count += 1

        chunk_indexing_future.result()  # ensure chunk indexing completed

    print(f"Processed {valid_rules_count} valid rules for document {document_id}")

    doc = db.query(Document).filter(Document.id == document_id).first()
    if doc:
        meta = dict(doc.metadata_ or {})
        meta["status"] = "completed"
        # Found live during verification: a document that fails, retries,
        # then succeeds kept the *previous* attempt's error message forever
        # — genuinely confusing (a "completed" doc showing a stale error).
        meta.pop("error", None)
        doc.metadata_ = meta
        db.commit()

    return {"status": "success", "chunks_count": len(chunks), "rules_extracted": valid_rules_count}


@celery_app.task(name="process_url", bind=True, max_retries=INGESTION_MAX_RETRIES)
def process_url_task(self, document_id: str, url: str):
    from .services.web_service import crawl_url_to_blocks
    from .database import SessionLocal
    from .models import Document

    task_id = self.request.id
    attempt = self.request.retries
    logger.info("[ingestion] task_id=%s document_id=%s process_url started (attempt %d)", task_id, document_id, attempt + 1)

    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == document_id).first()
        if not doc:
            # The record this task_id was dispatched for no longer exists —
            # retrying can't recreate it (matches Step 5's own example of a
            # permanent, non-retryable condition).
            raise NonRetryableIngestionError(f"Document {document_id!r} not found — nothing to process.")

        # Idempotency guard: a redelivered/duplicate dispatch of a task whose
        # document already finished successfully is skipped rather than
        # re-run — the ingestion pipeline isn't idempotent (fresh chunk/rule
        # ids every run; see api/upload.py's /reprocess endpoint, which has
        # to explicitly delete old rows before a legitimate re-run). A real
        # reprocess request resets status to "uploaded" before dispatching
        # (see upload.py), so it is never blocked by this guard.
        if (doc.metadata_ or {}).get("status") == "completed":
            logger.info("[ingestion] task_id=%s document_id=%s already completed — skipping duplicate run", task_id, document_id)
            return {"status": "success", "skipped": "already_completed"}

        _mark_status(db, document_id, status="processing", task_id=task_id, retry_count=attempt)

        blocks_data, title = crawl_url_to_blocks(url)
        if not blocks_data:
            raise NonRetryableIngestionError("No content could be extracted from this URL.")

        if title:
            doc.name = title
            db.commit()

        result = _process_text_blocks(document_id, blocks_data, db)
        logger.info("[ingestion] task_id=%s document_id=%s process_url COMPLETED", task_id, document_id)
        return result
    except NonRetryableIngestionError as e:
        logger.error("[ingestion] task_id=%s document_id=%s permanent failure, not retrying: %s", task_id, document_id, e)
        db.rollback()
        _mark_status(db, document_id, status="failed", error=str(e))
        return {"status": "error", "message": str(e)}
    except Exception as e:
        db.rollback()
        # Checked explicitly rather than catching MaxRetriesExceededError:
        # Celery's Task.retry(exc=e, ...) re-raises the *original* exception
        # once retries are exhausted (not MaxRetriesExceededError) whenever
        # an `exc` is passed — confirmed against celery/app/task.py's own
        # retry() source, both in eager tests and by reading the real
        # non-eager code path (same branch, no is_eager check on it). Pre-
        # checking the retry budget here avoids depending on that exception-
        # selection quirk and makes both outcomes explicit.
        if self.request.retries >= self.max_retries:
            logger.error(
                "[ingestion] task_id=%s document_id=%s FAILED after %d attempts: %s",
                task_id, document_id, self.max_retries, e,
            )
            _mark_status(db, document_id, status="failed", error=str(e))
            return {"status": "error", "message": str(e)}
        logger.warning(
            "[ingestion] task_id=%s document_id=%s attempt %d failed, retrying: %s",
            task_id, document_id, attempt + 1, e,
        )
        _mark_status(db, document_id, status="retrying", error=str(e), retry_count=attempt + 1)
        raise self.retry(exc=e, countdown=_ingestion_retry_countdown(attempt + 1))
    finally:
        db.close()


@celery_app.task(name="process_document", bind=True, max_retries=INGESTION_MAX_RETRIES)
def process_document_task(self, document_id: str, file_path: str):
    from .services.parsing import parse_pdf
    from .database import SessionLocal
    from .models import Chunk, Document

    task_id = self.request.id
    attempt = self.request.retries
    logger.info("[ingestion] task_id=%s document_id=%s process_document started (attempt %d)", task_id, document_id, attempt + 1)

    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == document_id).first()
        if not doc:
            raise NonRetryableIngestionError(f"Document {document_id!r} not found — nothing to process.")

        # Idempotency guard — see process_url_task's identical comment above.
        if (doc.metadata_ or {}).get("status") == "completed":
            logger.info("[ingestion] task_id=%s document_id=%s already completed — skipping duplicate run", task_id, document_id)
            return {"status": "success", "skipped": "already_completed"}

        if not os.path.exists(file_path):
            raise NonRetryableIngestionError(f"Source file no longer exists on disk: {file_path!r}")

        _mark_status(db, document_id, status="processing", task_id=task_id, retry_count=attempt)

        ext = os.path.splitext(file_path)[1].lower()
        AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".webm", ".wma"}
        TEXT_EXTS = {".md", ".txt"}

        if ext in TEXT_EXTS:
            from .services.parsing import parse_text_file

            blocks_data = parse_text_file(file_path)
            result = _process_text_blocks(document_id, blocks_data, db)
            logger.info("[ingestion] task_id=%s document_id=%s process_document (text) COMPLETED", task_id, document_id)
            return result

        if ext in AUDIO_EXTS:
            from .services.audio_service import (
                validate_audio_format,
                transcribe_audio,
                merge_small_segments,
                chunk_audio_transcript
            )
            from .services.canonicalization import store_chunks_batch_in_pinecone
            
            print(f"[Worker] Starting Audio Processing Pipeline for {document_id} ({ext})...")
            validation = validate_audio_format(file_path)
            if not validation.get("is_valid", True):
                raise NonRetryableIngestionError(validation.get("reason", "Invalid audio file"))
                
            raw_segments = transcribe_audio(file_path)
            merged_segments = merge_small_segments(raw_segments)
            chunks = chunk_audio_transcript(document_id, merged_segments)
            print(f"[Worker] Created {len(chunks)} audio transcript chunks for {document_id}")
            
            # Save chunks to DB
            db_chunks = []
            for c in chunks:
                db_chunks.append(
                    Chunk(
                        id=c["chunk_id"],
                        document_id=c["document_id"],
                        page=c["page"],
                        section=c["section"],
                        content=c["content"]
                    )
                )
            db.add_all(db_chunks)
            db.commit()
            
            # Index into Pinecone
            store_chunks_batch_in_pinecone(chunks)
            
            if doc:
                meta = dict(doc.metadata_ or {})
                meta["status"] = "completed"
                meta.pop("error", None)  # see _process_text_blocks's identical fix above
                meta["is_audio"] = True
                meta["audio_segments_count"] = len(merged_segments)
                doc.metadata_ = meta
                db.commit()

            logger.info("[ingestion] task_id=%s document_id=%s process_document (audio) COMPLETED", task_id, document_id)
            return {"status": "success", "chunks_count": len(chunks), "type": "audio"}

        md_content = parse_pdf(file_path)
        result = _process_text_blocks(document_id, md_content, db)
        logger.info("[ingestion] task_id=%s document_id=%s process_document COMPLETED", task_id, document_id)
        return result
    except (NonRetryableIngestionError, FileNotFoundError) as e:
        # FileNotFoundError is treated the same as the explicit check above —
        # belt-and-suspenders for a file that vanishes between the exists()
        # check and a parser actually opening it (e.g. a concurrent cleanup).
        logger.error("[ingestion] task_id=%s document_id=%s permanent failure, not retrying: %s", task_id, document_id, e)
        db.rollback()
        _mark_status(db, document_id, status="failed", error=str(e))
        return {"status": "error", "message": str(e)}
    except Exception as e:
        db.rollback()
        if self.request.retries >= self.max_retries:
            logger.error(
                "[ingestion] task_id=%s document_id=%s FAILED after %d attempts: %s",
                task_id, document_id, self.max_retries, e,
            )
            _mark_status(db, document_id, status="failed", error=str(e))
            return {"status": "error", "message": str(e)}
        logger.warning(
            "[ingestion] task_id=%s document_id=%s attempt %d failed, retrying: %s",
            task_id, document_id, attempt + 1, e,
        )
        _mark_status(db, document_id, status="retrying", error=str(e), retry_count=attempt + 1)
        raise self.retry(exc=e, countdown=_ingestion_retry_countdown(attempt + 1))
    finally:
        db.close()


# ── HR recruitment panel ─────────────────────────────────────────────────
# Resume processing. All logic and all idempotency live in
# services/recruitment_service.py::process_resume_upload; this task only adds
# the retry policy. Safe to dispatch any number of times for one upload id:
# only the call that wins the queued|failed -> processing claim does any work,
# so a Celery retry, a duplicate dispatch, or a user double-clicking Retry can
# never create a second candidate, application, or history entry.
RESUME_MAX_RETRIES = 3


@celery_app.task(name="process_resume", bind=True, max_retries=RESUME_MAX_RETRIES)
def process_resume_task(self, upload_id: str):
    from .database import SessionLocal
    from .services import recruitment_service

    task_id = self.request.id
    attempt = self.request.retries
    logger.info("[recruitment] task_id=%s upload_id=%s process_resume started (attempt %d)", task_id, upload_id, attempt + 1)

    db = SessionLocal()
    try:
        try:
            result = recruitment_service.process_resume_upload(db, upload_id)
        except Exception as e:
            # The service has already recorded the failure on the row. Retry
            # only genuinely transient trouble, and only while retries remain;
            # after that the row stays "failed" with the real reason for HR to
            # see and retry by hand.
            if attempt >= self.max_retries:
                logger.error("[recruitment] task_id=%s upload_id=%s FAILED after %d attempts: %s", task_id, upload_id, attempt + 1, e)
                return {"outcome": "failed", "error": str(e)}
            logger.warning("[recruitment] task_id=%s upload_id=%s attempt %d failed, retrying: %s", task_id, upload_id, attempt + 1, e)
            recruitment_service.mark_upload(
                db, upload_id, "queued", f"Temporary problem, retrying (attempt {attempt + 2} of {self.max_retries + 1}): {e}"
            )
            raise self.retry(exc=e, countdown=_ingestion_retry_countdown(attempt + 1))
        logger.info("[recruitment] task_id=%s upload_id=%s -> %s", task_id, upload_id, result.get("outcome"))
        return result
    finally:
        db.close()
