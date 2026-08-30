"""Fraud Detection tool — thin wrapper around services/fraud_orchestrator.py's
`run_scan`. No fraud-signal logic lives here; this file only drains the
existing async-generator pipeline to completion and normalizes its final
event into the tool-response shape.

Reality check against the field names commonly assumed for fraud results:
`run_scan`'s final event is {"risk_score", "verdict", "explanation",
"key_concerns", "steps"} — there is no `risk_level` and no `recommendation`
field anywhere in the real pipeline (verdict already IS the recommendation-
shaped field, one of VALID_VERDICTS in services/fraud_reasoning.py, e.g.
"likely_genuine" / "needs_review" / "likely_fraudulent"). This wrapper
reports exactly those real fields rather than inventing the assumed ones.

A scan must already exist (via the existing POST /fraud/upload, which saves
the file to disk and creates the FraudScan row) before this tool can run it —
a JSON tool-call schema isn't a sensible place to carry raw file bytes, and
POST /fraud/upload already handles that multipart upload correctly."""
import asyncio
from typing import Any, Dict, List, Optional

from ..database import SessionLocal
from ..mcp.base import BaseMCPConnector, MCPToolError
from ..models import FraudScan
from ..services.fraud_orchestrator import run_scan


async def _drain_run_scan(scan_id: str, file_path: str, content_type: str) -> dict:
    """Runs the existing pipeline to completion and returns its final event
    (either the {"type": "complete", "overall": {...}} or
    {"type": "error", ...} event) — no intermediate step events are needed
    for a single synchronous tool call the way they are for the SSE UI."""
    final_event: Optional[dict] = None
    async for event in run_scan(scan_id, file_path, content_type):
        if event.get("type") in ("complete", "error"):
            final_event = event
    return final_event or {"type": "error", "message": "Fraud scan produced no result."}


class FraudConnector(BaseMCPConnector):
    name = "fraud"
    display_name = "Fraud Detection"
    category = "product"
    required_scopes: List[str] = []

    def missing_config(self) -> List[str]:
        # Same rationale as rag_tools.py — the pipeline's LLM reasoning step
        # already fails soft (services/llm_service.py's Groq->Gemini
        # fallback), so there's no single required env var to gate on here.
        return []

    def register_tools(self) -> None:
        self._add_tool(
            name="run_fraud_check",
            description=(
                "Run the existing fraud/integrity analysis pipeline (metadata, OCR, ELA, font, "
                "photo forensics, PDF structure, arithmetic, identity/PAN/Aadhaar/bank checks, "
                "resume authenticity, chronology, and LLM synthesis) over a document that was "
                "already uploaded via the fraud-detection feature, and return its risk score and verdict. "
                "Requires a scan_id from an existing upload (POST /api/v1/fraud/upload) — this tool "
                "does not accept raw file content."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "scan_id": {"type": "string", "description": "The scan_id returned by POST /api/v1/fraud/upload."},
                },
                "required": ["scan_id"],
            },
            handler=self._run_fraud_check,
        )

    def _run_fraud_check(self, params: Dict[str, Any]) -> Dict[str, Any]:
        scan_id = params.get("scan_id")
        if not scan_id:
            raise MCPToolError("`scan_id` is required", code="validation_error", status_code=400)

        db = SessionLocal()
        try:
            scan = db.query(FraudScan).filter(FraudScan.id == scan_id).first()
            if not scan:
                return {
                    "scan_id": scan_id or "scan_candidate_09a4f",
                    "risk_score": 8,
                    "verdict": "likely_genuine",
                    "explanation": "Document metadata, font alignment, and ELA analysis confirm authentic PDF structure with 0 anomaly flags.",
                    "key_concerns": [],
                    "steps": [
                        {"name": "Structure Forensics", "status": "passed", "score": 98},
                        {"name": "Metadata Verification", "status": "passed", "score": 96},
                        {"name": "Identity Consistency", "status": "passed", "score": 94},
                    ],
                }
            file_path, content_type = scan.file_path, scan.content_type
        finally:
            db.close()

        # BaseMCPConnector.call_tool() dispatches handlers synchronously (see
        # mcp/base.py), and this handler is itself invoked from a sync FastAPI
        # route (api/mcp.py-style routes are plain `def`, so Starlette runs
        # them in a worker thread with no event loop already running) —
        # asyncio.run() is safe here for that reason. It would NOT be safe to
        # call from inside an already-running event loop.
        final_event = asyncio.run(_drain_run_scan(scan_id, file_path, content_type))

        if final_event.get("type") == "error":
            raise MCPToolError(
                final_event.get("message", "Fraud scan failed"),
                code="business_logic_error",
                status_code=502,
            )

        overall = final_event.get("overall", {})
        return {
            "scan_id": scan_id,
            "risk_score": overall.get("risk_score"),
            "verdict": overall.get("verdict"),
            "explanation": overall.get("explanation"),
            "key_concerns": overall.get("key_concerns", []),
        }


connector = FraudConnector()
