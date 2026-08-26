import os
from celery import Celery
from .config import settings

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
)

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
        doc.metadata_ = meta
        db.commit()

    return {"status": "success", "chunks_count": len(chunks), "rules_extracted": valid_rules_count}


@celery_app.task(name="process_url")
def process_url_task(document_id: str, url: str):
    from .services.web_service import crawl_url_to_blocks
    from .database import SessionLocal
    from .models import Document

    print(f"[Worker] Crawling URL for {document_id}: {url}")
    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == document_id).first()
        if doc:
            meta = dict(doc.metadata_ or {})
            meta["status"] = "processing"
            doc.metadata_ = meta
            db.commit()

        blocks_data, title = crawl_url_to_blocks(url)
        if not blocks_data:
            raise ValueError("No content could be extracted from this URL.")

        if doc and title:
            doc.name = title
            db.commit()

        return _process_text_blocks(document_id, blocks_data, db)
    except Exception as e:
        print(f"Error crawling URL for {document_id}: {str(e)}")
        db.rollback()

        doc = db.query(Document).filter(Document.id == document_id).first()
        if doc:
            meta = dict(doc.metadata_ or {})
            meta["status"] = "failed"
            meta["error"] = str(e)
            doc.metadata_ = meta
            db.commit()

        return {"status": "error", "message": str(e)}
    finally:
        db.close()


@celery_app.task(name="process_document")
def process_document_task(document_id: str, file_path: str):
    # This will be implemented in the pipeline phase
    # For now, it will just call the parsing and chunking services
    from .services.parsing import parse_pdf
    from .database import SessionLocal
    from .models import Chunk, Document
    
    print(f"Processing document {document_id} from {file_path}")
    db = SessionLocal()
    try:
        # Update status to processing
        doc = db.query(Document).filter(Document.id == document_id).first()
        if doc:
            meta = dict(doc.metadata_ or {})
            meta["status"] = "processing"
            doc.metadata_ = meta
            db.commit()

        ext = os.path.splitext(file_path)[1].lower()
        AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".webm", ".wma"}
        TEXT_EXTS = {".md", ".txt"}

        if ext in TEXT_EXTS:
            from .services.parsing import parse_text_file

            blocks_data = parse_text_file(file_path)
            return _process_text_blocks(document_id, blocks_data, db)

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
                raise ValueError(validation.get("reason", "Invalid audio file"))
                
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
                meta["is_audio"] = True
                meta["audio_segments_count"] = len(merged_segments)
                doc.metadata_ = meta
                db.commit()
                
            return {"status": "success", "chunks_count": len(chunks), "type": "audio"}

        md_content = parse_pdf(file_path)
        return _process_text_blocks(document_id, md_content, db)
    except Exception as e:
        print(f"Error processing document {document_id}: {str(e)}")
        db.rollback()
        
        # Mark as error
        doc = db.query(Document).filter(Document.id == document_id).first()
        if doc:
            meta = dict(doc.metadata_ or {})
            meta["status"] = "failed"
            meta["error"] = str(e)
            doc.metadata_ = meta
            db.commit()

        return {"status": "error", "message": str(e)}
    finally:
        db.close()
