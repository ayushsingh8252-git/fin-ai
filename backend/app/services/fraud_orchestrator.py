import asyncio
from typing import AsyncGenerator
from ..database import SessionLocal
from ..models import FraudScan
from . import (
    fraud_metadata, fraud_ocr, fraud_arithmetic, fraud_ela, fraud_font, fraud_identity,
    fraud_resume_authenticity, fraud_reasoning, fraud_pan, fraud_aadhaar, fraud_bank_document,
    fraud_photo_forensics, fraud_qr, fraud_unicode_injection, fraud_pdf_structure,
    fraud_text_alignment, fraud_chronology,
)


def _save(scan_id: str, status: str, result: dict) -> None:
    db = SessionLocal()
    try:
        scan = db.query(FraudScan).filter(FraudScan.id == scan_id).first()
        if scan:
            scan.status = status
            scan.result = result
            db.commit()
    finally:
        db.close()


async def run_scan(
    scan_id: str, file_path: str, content_type: str, ip_address: str | None = None, user_agent: str | None = None
) -> AsyncGenerator[dict, None]:
    steps: list[dict] = []

    def emit_and_save(status: str):
        _save(scan_id, status, {"steps": steps})

    try:
        # Stage 1: File metadata, OCR, ELA, font analysis, photo forensics, PDF structure, and text alignment
        (
            metadata_step,
            (text, ocr_step),
            ela_step,
            font_step,
            photo_forensics_step,
            pdf_structure_step,
            text_alignment_step
        ) = await asyncio.gather(
            asyncio.to_thread(fraud_metadata.check_metadata, file_path, content_type),
            asyncio.to_thread(fraud_ocr.extract_text, file_path, content_type),
            asyncio.to_thread(fraud_ela.check_ela, file_path, content_type),
            asyncio.to_thread(fraud_font.check_fonts, file_path, content_type),
            asyncio.to_thread(fraud_photo_forensics.check_photo_forensics, file_path, content_type),
            asyncio.to_thread(fraud_pdf_structure.check_pdf_structure, file_path, content_type),
            asyncio.to_thread(fraud_text_alignment.check_text_alignment, file_path, content_type),
        )
        stage1_steps = (
            metadata_step, ocr_step, ela_step, font_step, photo_forensics_step,
            pdf_structure_step, text_alignment_step
        )
        for step in stage1_steps:
            steps.append(step)
        emit_and_save("scanning")
        for step in stage1_steps:
            yield {"type": "step", "step": step}

        # Stage 2: Arithmetic, identity extraction, ID checks (PAN/Aadhaar/bank), QR verification, and Unicode injection defense
        (
            arithmetic_step,
            (identity_step, extracted_identity),
            pan_step,
            aadhaar_step,
            bank_step,
            qr_step,
            unicode_step
        ) = await asyncio.gather(
            asyncio.to_thread(fraud_arithmetic.check_arithmetic, text, ocr_step.get("score")),
            asyncio.to_thread(fraud_identity.check_identity, scan_id, text, ip_address, user_agent),
            asyncio.to_thread(fraud_pan.check_pan, text),
            asyncio.to_thread(fraud_aadhaar.check_aadhaar, text),
            asyncio.to_thread(fraud_bank_document.check_bank_details, text),
            asyncio.to_thread(fraud_qr.check_qr_ground_truth, file_path, content_type, text),
            asyncio.to_thread(fraud_unicode_injection.check_unicode_and_injections, text),
        )
        stage2_steps = (
            arithmetic_step, identity_step, pan_step, aadhaar_step, bank_step,
            qr_step, unicode_step
        )
        for step in stage2_steps:
            steps.append(step)
        emit_and_save("scanning")
        for step in stage2_steps:
            yield {"type": "step", "step": step}

        # Stage 3: Resume authenticity and chronological feasibility
        dob_val = extracted_identity.dob if extracted_identity else None
        resume_step, chronology_step = await asyncio.gather(
            asyncio.to_thread(
                fraud_resume_authenticity.check_resume_authenticity, scan_id, text, file_path, content_type, extracted_identity
            ),
            asyncio.to_thread(
                fraud_chronology.check_chronological_feasibility, dob_str=dob_val, extracted_text=text
            ),
        )
        for step in (resume_step, chronology_step):
            steps.append(step)
        emit_and_save("scanning")
        for step in (resume_step, chronology_step):
            yield {"type": "step", "step": step}

        # Stage 4: reasoning needs every prior step's output.
        reasoning_step = await asyncio.to_thread(fraud_reasoning.synthesize, text, steps)
        steps.append(reasoning_step)
        yield {"type": "step", "step": reasoning_step}

        overall = {
            "risk_score": reasoning_step.get("risk_score"),
            "verdict": reasoning_step.get("verdict"),
            "explanation": reasoning_step.get("explanation"),
            "key_concerns": reasoning_step.get("key_concerns", []),
            "steps": steps,
        }
        # Persist the top-level verdict alongside the steps — emit_and_save
        # only ever wrote {"steps": steps}, so a client re-fetching a
        # completed scan via GET /fraud/scan/{id} (instead of replaying the
        # SSE stream) previously had no top-level risk_score/verdict/
        # explanation to read, only the same fields nested in steps[-1].
        _save(scan_id, "complete", overall)
        yield {"type": "complete", "overall": overall}

    except Exception as e:
        error_payload = {"steps": steps, "error": str(e)}
        _save(scan_id, "error", error_payload)
        yield {"type": "error", "message": str(e), "steps": steps}
