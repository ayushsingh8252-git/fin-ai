"""Plan-based tool calling: one LLM call turns a natural-language prompt into
an ordered list of tool-call steps drawn from the unified catalog
(registry.unified_catalog()), then a plain sequential executor runs each step
through registry.call_tool(). Reuses services/llm_service.py::generate_json_resilient
for the planning call — no new LLM-calling code, no new provider wiring.

Deliberately NOT a fully open-ended agent loop (no unbounded re-planning,
no tool calling itself in a cycle) — a flat plan-then-execute pass keeps this
auditable and bounds the blast radius of a bad plan, which matters
concretely here: several tools in the catalog cost real money (place_screening_call
via Sarvam) or send real messages (send_whatsapp_message, send_email), and
this platform has no auth layer yet (see platform audit) — an unbounded
planner would be materially riskier than this bounded one.

Step-to-step data flow: a step's params may reference an earlier step's
result with the literal string "$stepN.path.to.field" (1-indexed) instead of
a literal value — resolved by _resolve_placeholders before that step runs.
"""
import json
import re
from contextlib import nullcontext
from typing import Any, Dict, List, Optional

from ..services.llm_service import generate_json_resilient
from ..services.llmops import get_langfuse, get_prompt_text, new_trace_id
from . import registry
from .registry import MCPToolError

_STEP_REF_RE = re.compile(r"^\$step(\d+)((?:\.[A-Za-z0-9_]+)*)$")

# Langfuse-managed prompt name (see _planner_system_instruction below) — this
# name must match whatever it's seeded/edited as in the Langfuse UI under
# Prompts. The literal text below is now only the fallback used when
# Langfuse is unconfigured/unreachable/doesn't have this prompt yet, not the
# live source of truth — edit prompts in Langfuse going forward, not here.
_PLANNER_PROMPT_NAME = "agent-planner-system"

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


def _planner_system_instruction() -> str:
    return get_prompt_text(_PLANNER_PROMPT_NAME, _PLANNER_SYSTEM_INSTRUCTION)


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


def build_plan(prompt: str, langfuse_trace_id: Optional[str] = None) -> Dict[str, Any]:
    """Prompt -> {"steps": [...]}. Does not execute anything.

    `langfuse_trace_id`, if given, nests the planning LLM call under the
    caller's own Langfuse trace (see plan_and_run below). If omitted and
    Langfuse is configured, a fresh trace_id is minted here so a standalone
    /agent/plan call is still traceable — returned under "trace_id" in that
    case only, so plan_and_run's own trace_id (already returned at its own
    level) is never duplicated.
    """
    minted_own_trace = langfuse_trace_id is None
    if minted_own_trace:
        langfuse_trace_id = new_trace_id()

    catalog = registry.unified_catalog()
    catalog_text = json.dumps(catalog, indent=None)

    llm_prompt = f"Available tools:\n{catalog_text}\n\nUser request:\n{prompt}"
    try:
        raw = generate_json_resilient(
            llm_prompt, _planner_system_instruction(), langfuse_trace_id=langfuse_trace_id
        )
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

    result = {"steps": steps}
    if minted_own_trace and langfuse_trace_id:
        result["trace_id"] = langfuse_trace_id
    return result


def execute_plan(plan: Dict[str, Any], langfuse_trace_id: Optional[str] = None) -> Dict[str, Any]:
    """Runs each step in order via registry.call_tool(), resolving
    "$stepN.field" references against prior results. Stops at the first
    failing step (fail-fast, not fail-open — a partially-completed hiring
    workflow should be visible, not silently skipped over) but still returns
    every step attempted so far.

    `langfuse_trace_id`, if given, makes each executed step a Langfuse span
    nested under the caller's trace — so a multi-step plan (e.g. score a
    candidate, then run fraud check, then query RAG) shows up as one tool
    tree, not N disconnected calls."""
    lf = get_langfuse()
    results: List[Dict[str, Any]] = []
    for i, step in enumerate(plan.get("steps", []), start=1):
        if step.get("invalid"):
            results.append({"step": i, "connector": step.get("connector"), "tool": step.get("tool"), "error": "Unknown connector/tool — not in the catalog.", "ok": False})
            break

        resolved_params = _resolve_placeholders(step.get("params", {}), results)
        trace_context = {"trace_id": langfuse_trace_id} if langfuse_trace_id else None
        span_cm = (
            lf.start_as_current_observation(
                name=f"tool:{step['tool']}",
                as_type="tool",
                trace_context=trace_context,
                input=resolved_params,
                metadata={"connector": step["connector"], "step": i},
            )
            if lf is not None
            else nullcontext()
        )
        try:
            with span_cm as span:
                result = registry.call_tool(step["connector"], step["tool"], resolved_params)
                if span is not None:
                    span.update(output=result)
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
    """One Langfuse trace per call, covering both stages: the planning
    generation (inside build_plan) and every executed tool step (inside
    execute_plan) all nest under this function's own root span, giving one
    coherent trace tree for a full plan-then-execute run — see
    services/llmops.py's docstrings for how the trace_id plumbing works."""
    lf = get_langfuse()
    trace_id = new_trace_id()
    root_cm = (
        lf.start_as_current_observation(
            name="agent.plan_and_run",
            as_type="agent",
            trace_context={"trace_id": trace_id} if trace_id else None,
            input=prompt,
        )
        if lf is not None
        else nullcontext()
    )
    with root_cm as root:
        plan = build_plan(prompt, langfuse_trace_id=trace_id)
        if plan.get("error"):
            execution = {"steps": [], "completed": False, "final_result": None}
        else:
            execution = execute_plan(plan, langfuse_trace_id=trace_id)
        if root is not None:
            root.update(output=execution)

    result = {"plan": plan, "execution": execution}
    if trace_id:
        result["trace_id"] = trace_id
    return result
