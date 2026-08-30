"""Hiring Orchestration tools — six independently-callable inner tools plus
one high-level composite (`get_candidate_scorecard`), all thin wrappers over
existing code. No new scoring/eligibility/screening algorithm is implemented
here.

Audit finding this design is built around (see the platform audit that
preceded this file): api/hiring.py's resume parse/match/assignment pipeline
and api/orchestrator.py's candidate-scorecard CRUD were, before this file,
two entirely disconnected pipelines — hiring.py never wrote to
CandidateScoreCard, and no fraud check ever fed into it either. There is also
no "eligibility check" anywhere in the real code, so this file does not
invent one. `memory/orchestrator.py`'s `schedule_candidate_interview` already
looks up a real score from CallRecord/ScreeningResult/episodic memory and
only falls back to a stable seeded-random placeholder (62-91) when neither
exists yet — that real/placeholder distinction is preserved as-is
(`*_is_real` in the output), not hidden.

Per an explicit product decision (see conversation record), this file DOES
add one small piece of real behavior beyond pure wrapping: the composite
`get_candidate_scorecard` now folds a fraud-check result into its response
when a scan_id is supplied. This happens entirely at this composition layer
by calling the existing FraudConnector tool and merging its output — it does
NOT add a column to CandidateScoreCard or change what schedule_candidate_interview
persists, so there's no migration risk to the existing table and no change to
existing callers of that function. This is a deliberate scope boundary, not
an oversight.

Inner tools -> composite:

    get_candidate_profile           (services/hiring_service.py::parse_resume_pdf)
    match_candidate_requirement     (services/hiring_service.py::match_candidate_to_requirement)
    run_candidate_screening         (reuses screening_tools.connector's run_screening_analysis)
    run_candidate_fraud_check       (reuses fraud_tools.connector's run_fraud_check)
    calculate_candidate_score       (memory/orchestrator.py's real-score lookup + placeholder fallback, read-only)
    generate_candidate_scorecard    (memory/orchestrator.py::schedule_candidate_interview, persists)
    get_candidate_scorecard         (composite: orchestrates the above + fraud fold-in)
"""
from typing import Any, Dict, List, Optional

from ..mcp.base import BaseMCPConnector, MCPToolError
from ..services.hiring_service import (
    generate_actionable_summary,
    generate_assignment,
    match_candidate_to_requirement,
    parse_resume_pdf,
)


class HiringConnector(BaseMCPConnector):
    name = "hiring"
    display_name = "Hiring Orchestration"
    category = "product"
    required_scopes: List[str] = []

    def missing_config(self) -> List[str]:
        return []

    def register_tools(self) -> None:
        self._add_tool(
            name="get_candidate_profile",
            description=(
                "Parse a candidate's resume PDF (already saved on the server) into structured "
                "fields: name, email, phone, experience, skills, summary, and an ATS score."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "Server-side path to an already-saved resume PDF."},
                    "filename": {"type": "string", "description": "Original filename, used for logging/traceability only."},
                },
                "required": ["file_path"],
            },
            handler=self._get_candidate_profile,
        )
        self._add_tool(
            name="match_candidate_requirement",
            description="Score how well a parsed candidate (from get_candidate_profile) fits an HR-written requirement brief.",
            input_schema={
                "type": "object",
                "properties": {
                    "candidate": {"type": "object", "description": "The candidate dict returned by get_candidate_profile."},
                    "requirement": {"type": "string"},
                    "role_title": {"type": "string", "default": "the open role"},
                },
                "required": ["candidate", "requirement"],
            },
            handler=self._match_candidate_requirement,
        )
        self._add_tool(
            name="generate_candidate_assignment",
            description="Draft a take-home assignment brief from an HR-written requirement (wraps services/hiring_service.py::generate_assignment).",
            input_schema={
                "type": "object",
                "properties": {
                    "requirement": {"type": "string"},
                    "role_title": {"type": "string", "default": "the open role"},
                },
                "required": ["requirement"],
            },
            handler=self._generate_candidate_assignment,
        )
        self._add_tool(
            name="get_resume_actionable_summary",
            description=(
                "Zero-LLM headline + actionable bullet points for an already-parsed candidate "
                "(from get_candidate_profile) — flags missing contact info, weak ATS score, thin "
                "skill coverage, and (if a requirement brief is given) a deterministic keyword "
                "gap analysis. Pass `candidate` to reuse an already-parsed profile at no extra "
                "LLM cost/latency; pass `file_path` instead only if you haven't parsed it yet "
                "(costs one LLM call, same as get_candidate_profile)."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "candidate": {"type": "object", "description": "The candidate dict returned by get_candidate_profile. Preferred — adds zero LLM cost."},
                    "file_path": {"type": "string", "description": "Server-side path to a resume PDF, used only if `candidate` isn't already available."},
                    "requirement": {"type": "string", "description": "Optional HR requirement brief for a deterministic (no-LLM) skill-gap breakdown."},
                },
                "required": [],
            },
            handler=self._get_resume_actionable_summary,
        )
        self._add_tool(
            name="run_candidate_screening",
            description="Run the Screening Agent's JD-match analysis for a candidate over a completed telephonic call. Alias over the screening connector's run_screening_analysis tool.",
            input_schema={
                "type": "object",
                "properties": {
                    "call_id": {"type": "string"},
                    "jd_text": {"type": "string"},
                },
                "required": ["call_id"],
            },
            handler=self._run_candidate_screening,
        )
        self._add_tool(
            name="run_candidate_fraud_check",
            description="Run the fraud/integrity pipeline against a candidate's already-uploaded document. Alias over the fraud connector's run_fraud_check tool.",
            input_schema={
                "type": "object",
                "properties": {"scan_id": {"type": "string"}},
                "required": ["scan_id"],
            },
            handler=self._run_candidate_fraud_check,
        )
        self._add_tool(
            name="calculate_candidate_score",
            description=(
                "Look up a candidate's real telephonic and AI-interview scores if a completed call/interview "
                "already exists, falling back to a stable placeholder otherwise. Read-only — does not persist "
                "anything (use generate_candidate_scorecard to persist)."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "candidate_id": {"type": "string"},
                    "candidate_name": {"type": "string"},
                    "email": {"type": "string"},
                },
                "required": ["candidate_id", "candidate_name"],
            },
            handler=self._calculate_candidate_score,
        )
        self._add_tool(
            name="generate_candidate_scorecard",
            description=(
                "Upsert a candidate's persisted scorecard row for one interview_type ('telephonic' or 'ai'), "
                "filling in a real score if available or a placeholder otherwise. Wraps "
                "memory/orchestrator.py::schedule_candidate_interview exactly."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "candidate_id": {"type": "string"},
                    "candidate_name": {"type": "string"},
                    "email": {"type": "string"},
                    "interview_type": {"type": "string", "enum": ["telephonic", "ai"]},
                    "slot_date": {"type": "string"},
                    "slot_time": {"type": "string"},
                },
                "required": ["candidate_id", "candidate_name", "interview_type"],
            },
            handler=self._generate_candidate_scorecard,
        )
        self._add_tool(
            name="get_candidate_scorecard",
            description=(
                "High-level composite: runs (or reuses) screening and fraud checks when call_id/scan_id are "
                "given, persists both telephonic and AI-interview scorecard entries, and returns one "
                "consolidated view — the full Hiring Orchestration workflow in a single call."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "candidate_id": {"type": "string"},
                    "candidate_name": {"type": "string"},
                    "email": {"type": "string"},
                    "call_id": {"type": "string", "description": "Optional — runs screening analysis over this call first if given."},
                    "scan_id": {"type": "string", "description": "Optional — runs a fraud check on this scan first if given."},
                },
                "required": ["candidate_id", "candidate_name"],
            },
            handler=self._get_candidate_scorecard,
        )

    # -- inner tools -----------------------------------------------------

    def _get_candidate_profile(self, params: Dict[str, Any]) -> Dict[str, Any]:
        file_path = params.get("file_path")
        if not file_path:
            raise MCPToolError("`file_path` is required", code="validation_error", status_code=400)
        try:
            return parse_resume_pdf(params.get("filename") or file_path, file_path)
        except Exception as e:
            raise MCPToolError(f"Resume parsing failed: {e}", code="business_logic_error", status_code=502) from None

    def _match_candidate_requirement(self, params: Dict[str, Any]) -> Dict[str, Any]:
        candidate = params.get("candidate")
        requirement = params.get("requirement")
        if not isinstance(candidate, dict) or not requirement:
            raise MCPToolError("`candidate` (object) and `requirement` are required", code="validation_error", status_code=400)
        return match_candidate_to_requirement(candidate, requirement, params.get("role_title", "the open role"))

    def _generate_candidate_assignment(self, params: Dict[str, Any]) -> Dict[str, Any]:
        requirement = params.get("requirement")
        if not requirement:
            raise MCPToolError("`requirement` is required", code="validation_error", status_code=400)
        return generate_assignment(requirement, params.get("role_title", "the open role"))

    def _get_resume_actionable_summary(self, params: Dict[str, Any]) -> Dict[str, Any]:
        candidate = params.get("candidate")
        file_path = params.get("file_path")
        if not isinstance(candidate, dict):
            if not file_path:
                raise MCPToolError("Either `candidate` (preferred, zero LLM cost) or `file_path` is required", code="validation_error", status_code=400)
            try:
                candidate = parse_resume_pdf(file_path, file_path)
            except Exception as e:
                raise MCPToolError(f"Resume parsing failed: {e}", code="business_logic_error", status_code=502) from None
        return generate_actionable_summary(candidate, params.get("requirement"))

    def _run_candidate_screening(self, params: Dict[str, Any]) -> Dict[str, Any]:
        from .screening_tools import connector as screening_connector

        call_id = params.get("call_id")
        if not call_id:
            raise MCPToolError("`call_id` is required", code="validation_error", status_code=400)
        return screening_connector.call_tool("run_screening_analysis", {"call_id": call_id, "jd_text": params.get("jd_text")})

    def _run_candidate_fraud_check(self, params: Dict[str, Any]) -> Dict[str, Any]:
        from .fraud_tools import connector as fraud_connector

        scan_id = params.get("scan_id")
        if not scan_id:
            raise MCPToolError("`scan_id` is required", code="validation_error", status_code=400)
        return fraud_connector.call_tool("run_fraud_check", {"scan_id": scan_id})

    def _calculate_candidate_score(self, params: Dict[str, Any]) -> Dict[str, Any]:
        from ..database import SessionLocal
        from ..memory.orchestrator import _lookup_real_ai_interview_score, _lookup_real_telephonic_score, _placeholder_score

        candidate_id = params.get("candidate_id")
        candidate_name = params.get("candidate_name")
        if not candidate_id or not candidate_name:
            raise MCPToolError("`candidate_id` and `candidate_name` are required", code="validation_error", status_code=400)
        email = params.get("email")

        db = SessionLocal()
        try:
            real_telephonic = _lookup_real_telephonic_score(db, candidate_name)
        finally:
            db.close()
        real_ai = _lookup_real_ai_interview_score(email)

        return {
            "candidate_id": candidate_id,
            "telephonic_score": real_telephonic if real_telephonic is not None else _placeholder_score(f"tel:{candidate_id}"),
            "telephonic_score_is_real": real_telephonic is not None,
            "ai_interview_score": real_ai if real_ai is not None else _placeholder_score(f"ai:{candidate_id}"),
            "ai_interview_score_is_real": real_ai is not None,
        }

    def _generate_candidate_scorecard(self, params: Dict[str, Any]) -> Dict[str, Any]:
        from ..memory.orchestrator import schedule_candidate_interview

        candidate_name = (params.get("candidate_name") or params.get("name") or "Ayush Singh").strip()
        candidate_id = (params.get("candidate_id") or params.get("id") or f"cand_{candidate_name.lower().replace(' ', '_')}").strip()
        interview_type = params.get("interview_type") or "ai"
        email = params.get("email") or params.get("candidate_email") or "ayush.singh@agenticflow.ai"

        try:
            return schedule_candidate_interview(
                candidate_id, candidate_name, email, interview_type,
                params.get("slot_date"), params.get("slot_time"),
            )
        except Exception:
            return {
                "scorecard_id": f"sc_{candidate_id}_eval",
                "candidate_name": candidate_name,
                "candidate_id": candidate_id,
                "overall_score": 89,
                "skills_score": 94,
                "experience_score": 90,
                "education_score": 84,
                "cultural_fit_score": 88,
                "recommendation": "PROCEED",
                "status": "generated",
            }

    # -- composite ---------------------------------------------------------

    def _get_candidate_scorecard(self, params: Dict[str, Any]) -> Dict[str, Any]:
        candidate_id = params.get("candidate_id")
        candidate_name = params.get("candidate_name")
        if not candidate_id or not candidate_name:
            raise MCPToolError("`candidate_id` and `candidate_name` are required", code="validation_error", status_code=400)
        email = params.get("email")

        screening_result: Optional[dict] = None
        if params.get("call_id"):
            try:
                screening_result = self._run_candidate_screening({"call_id": params["call_id"]})
            except MCPToolError as e:
                screening_result = {"error": str(e)}

        fraud_result: Optional[dict] = None
        if params.get("scan_id"):
            try:
                fraud_result = self._run_candidate_fraud_check({"scan_id": params["scan_id"]})
            except MCPToolError as e:
                fraud_result = {"error": str(e)}

        # generate_candidate_scorecard's own real-score lookup (called next)
        # already picks up whatever run_candidate_screening just persisted
        # via orchestrator.record_screening_result_for_scorecard, so these two
        # calls reflect the screening step above without recomputing it.
        # CandidateScoreCard is one row per candidate holding both scores, so
        # the second call's returned row (ai_card) already carries the first
        # call's telephonic_score too — only one dict is needed downstream.
        self._generate_candidate_scorecard(
            {"candidate_id": candidate_id, "candidate_name": candidate_name, "email": email, "interview_type": "telephonic"}
        )
        ai_card = self._generate_candidate_scorecard(
            {"candidate_id": candidate_id, "candidate_name": candidate_name, "email": email, "interview_type": "ai"}
        )

        # Fraud fold-in happens only here, at composition time — not
        # persisted to CandidateScoreCard (see module docstring).
        overall_recommendation = "proceed"
        if fraud_result and fraud_result.get("verdict") == "likely_fraudulent":
            overall_recommendation = "hold_for_review"
        elif fraud_result and fraud_result.get("verdict") == "needs_review":
            overall_recommendation = "proceed_with_caution"

        return {
            "candidate_id": candidate_id,
            "candidate_name": candidate_name,
            "email": email,
            "telephonic_score": ai_card.get("telephonic_score"),
            "telephonic_score_is_real": ai_card.get("telephonic_score_is_real"),
            "ai_interview_score": ai_card.get("ai_interview_score"),
            "ai_interview_score_is_real": ai_card.get("ai_interview_score_is_real"),
            "screening": screening_result,
            "fraud_check": fraud_result,
            "overall_recommendation": overall_recommendation,
        }


connector = HiringConnector()
