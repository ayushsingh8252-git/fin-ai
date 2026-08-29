"""Plan-based tool calling: one LLM call turns a natural-language prompt into
an ordered list of tool-call steps drawn from the unified catalog
(registry.unified_catalog()), then a plain sequential executor runs each step
through registry.call_tool(). Reuses services/llm_service.py::generate_json_resilient
for the planning call — no new LLM-calling code, no new provider wiring.

Deliberately NOT a fully open-ended agent loop (no unbounded re-planning,
no tool calling itself in a cycle) — a flat plan-then-execute pass keeps this
auditable and bounds the blast radius of a bad plan, which matters
concretely here: several tools in the catalog cost real money (place_screening_call
via Twilio) or send real messages (send_whatsapp_message, send_email), and
this platform has no auth layer yet (see platform audit) — an unbounded
planner would be materially riskier than this bounded one.

Step-to-step data flow: a step's params may reference an earlier step's
result with the literal string "$stepN.path.to.field" (1-indexed) instead of
a literal value — resolved by _resolve_placeholders before that step runs.
"""
import json
import re
from typing import Any, Dict, List, Optional

from ..services.llm_service import generate_json_resilient
from . import registry
from .registry import MCPToolError

_STEP_REF_RE = re.compile(r"^\$step(\d+)((?:\.[A-Za-z0-9_]+)*)$")

_PLANNER_SYSTEM_INSTRUCTION = """You are a tool-call planner for an HR automation platform. Given a user's \
request and a catalog of available tools, output STRICT JSON (no prose, no markdown fences) with this exact shape:

{"steps": [{"connector": "<connector name>", "tool": "<tool name>", "params": {...}}]}

Rules:
- Only use connector/tool names that literally appear in the catalog you were given.
- Prefer the smallest number of steps that satisfies the request. If a single composite tool \
(e.g. get_candidate_scorecard) already does what's asked, use just that one step instead of manually \
chaining its inner tools.
- If a later step needs an earlier step's output, set that param's value to the exact string \
"$stepN.field" (1-indexed, N = the earlier step's position, "field" = a key in that step's result) \
instead of guessing a literal value.
- If a tool's status is "not_configured", do not use it — explain in a step's params under a "_blocked" \
key why, or omit that part of the plan entirely.
- If nothing in the catalog can satisfy the request, return {"steps": []}.
Return ONLY the JSON object, nothing else."""


def _resolve_placeholders(value: Any, results: List[Dict[str, Any]]) -> Any:
    if isinstance(value, str):
        match = _STEP_REF_RE.match(value.strip())
        if not match:
            return value
        step_index = int(match.group(1)) - 1
        path = [p for p in match.group(2).split(".") if p]
        if step_index < 0 or step_index >= len(results):
            return value  # unresolved reference — leave as-is, the tool call will surface a clear validation error
        resolved: Any = results[step_index].get("result")
        for key in path:
            if isinstance(resolved, dict) and key in resolved:
                resolved = resolved[key]
            else:
                return value  # path doesn't exist — leave literal so the failure is visible, not silently swallowed
        return resolved
    if isinstance(value, dict):
        return {k: _resolve_placeholders(v, results) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve_placeholders(v, results) for v in value]
    return value


def build_plan(prompt: str) -> Dict[str, Any]:
    """Prompt -> {"steps": [...]}. Does not execute anything."""
    catalog = registry.unified_catalog()
    catalog_text = json.dumps(catalog, indent=None)

    llm_prompt = f"Available tools:\n{catalog_text}\n\nUser request:\n{prompt}"
    try:
        raw = generate_json_resilient(llm_prompt, _PLANNER_SYSTEM_INSTRUCTION)
    except Exception as e:
        return {"steps": [], "error": f"Planning failed: {e}"}

    if not isinstance(raw, dict) or not isinstance(raw.get("steps"), list):
        return {"steps": [], "error": "Planner returned an unexpected shape."}

    # Validate every step references a real (connector, tool) pair before
    # execution ever starts, rather than failing mid-plan on step 3 of 5.
    valid_pairs = {(c["connector"], c["tool"]) for c in catalog}
    steps = []
    for step in raw["steps"]:
        if not isinstance(step, dict):
            continue
        connector, tool = step.get("connector"), step.get("tool")
        if (connector, tool) not in valid_pairs:
            steps.append({"connector": connector, "tool": tool, "params": step.get("params", {}), "invalid": True})
        else:
            steps.append({"connector": connector, "tool": tool, "params": step.get("params", {})})
    return {"steps": steps}


def execute_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
    """Runs each step in order via registry.call_tool(), resolving
    "$stepN.field" references against prior results. Stops at the first
    failing step (fail-fast, not fail-open — a partially-completed hiring
    workflow should be visible, not silently skipped over) but still returns
    every step attempted so far."""
    results: List[Dict[str, Any]] = []
    for i, step in enumerate(plan.get("steps", []), start=1):
        if step.get("invalid"):
            results.append({"step": i, "connector": step.get("connector"), "tool": step.get("tool"), "error": "Unknown connector/tool — not in the catalog.", "ok": False})
            break

        resolved_params = _resolve_placeholders(step.get("params", {}), results)
        try:
            result = registry.call_tool(step["connector"], step["tool"], resolved_params)
            results.append({"step": i, "connector": step["connector"], "tool": step["tool"], "params": resolved_params, "result": result, "ok": True})
        except MCPToolError as e:
            results.append({"step": i, "connector": step["connector"], "tool": step["tool"], "params": resolved_params, "error": str(e), "error_code": e.code, "ok": False})
            break
        except Exception as e:
            results.append({"step": i, "connector": step["connector"], "tool": step["tool"], "params": resolved_params, "error": str(e), "error_code": "unexpected_error", "ok": False})
            break

    return {
        "steps": results,
        "completed": all(r.get("ok") for r in results) if results else False,
        "final_result": results[-1].get("result") if results and results[-1].get("ok") else None,
    }


def plan_and_run(prompt: str) -> Dict[str, Any]:
    plan = build_plan(prompt)
    if plan.get("error"):
        return {"plan": plan, "execution": {"steps": [], "completed": False, "final_result": None}}
    execution = execute_plan(plan)
    return {"plan": plan, "execution": execution}
