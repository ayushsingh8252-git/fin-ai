import json
import re
import urllib.request
import urllib.error
from google import genai
from google.genai import types
from ..config import settings
from .resilience import retry_with_backoff
from .key_manager import key_manager, is_rate_limit_error
from .model_config import GROQ_MODELS, GEMINI_MODELS, XAI_GROK_MODELS

# Global default Gemini Client (if single key configured in settings)
gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY) if settings.GEMINI_API_KEY else None
_gemini_clients_cache = {}


def _get_gemini_client(api_key: str):
    if api_key not in _gemini_clients_cache:
        _gemini_clients_cache[api_key] = genai.Client(api_key=api_key)
    return _gemini_clients_cache[api_key]


def _call_grok_groq_api(
    prompt: str,
    system_instruction: str = None,
    api_key: str = None,
    model_used: list | None = None,
    usage_used: list | None = None,
) -> str:
    """
    Attempts calling primary Grok / Groq OpenAI-compatible API endpoint.
    Supports both Groq (gsk_...) and xAI Grok (xai-...). Accepts optional specific api_key.

    `model_used`, if given, gets the winning model ID appended to it on
    success — the only way a caller can learn which of model_candidates
    actually answered, since the return value is just the raw text. Optional
    and additive (see key_manager.py::execute_json_generation, the only real
    caller that passes this — verify_live_keys.py and tests call this
    directly without it and are unaffected).
    """
    if not api_key:
        api_key = settings.GROK_API_KEY or settings.GROQ_API_KEY
    if not api_key:
        raise ValueError("No Grok/Groq API key found in configuration.")

    # Determine endpoint and model based on API key prefix
    if api_key.startswith("xai-"):
        base_url = "https://api.x.ai/v1/chat/completions"
        model_candidates = XAI_GROK_MODELS
    else:
        base_url = "https://api.groq.com/openai/v1/chat/completions"
        model_candidates = GROQ_MODELS

    messages = []
    # Groq JSON mode strictly requires the word 'json' in messages
    sys_content = system_instruction or "You are an expert AI assistant that responds strictly in valid JSON format."
    if "json" not in sys_content.lower() and "json" not in prompt.lower():
        sys_content += " You must format your response as a valid JSON object."
    messages.append({"role": "system", "content": sys_content})
    messages.append({"role": "user", "content": prompt})

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "AI-Policy-Rule-Engine/1.0",
    }

    last_err = None
    for model in model_candidates:
        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        }
        try:
            req = urllib.request.Request(
                base_url,
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                res_data = json.loads(resp.read().decode("utf-8"))
                if model_used is not None:
                    model_used.append(model)
                if usage_used is not None:
                    usage_used.append(res_data.get("usage"))
                return res_data["choices"][0]["message"]["content"]
        except Exception as e:
            last_err = e
            if is_rate_limit_error(e):
                raise e
            continue

    if last_err:
        raise last_err
    raise ValueError("All Groq/Grok model candidates failed.")


def _call_gemini_api(
    prompt: str,
    system_instruction: str = None,
    api_key: str = None,
    model_used: list | None = None,
    usage_used: list | None = None,
) -> str:
    """
    Calls fallback Gemini API, trying each model in model_config.GEMINI_MODELS
    in order. Accepts optional specific api_key.

    `model_used`, if given, gets the winning model ID appended on success —
    see _call_grok_groq_api's docstring above for why this exists.
    """
    client = _get_gemini_client(api_key) if api_key else gemini_client
    if not client:
        raise ValueError("Gemini API key not configured.")

    full_prompt = prompt
    if system_instruction:
        full_prompt = f"{system_instruction}\n\n{prompt}"

    for model_name in GEMINI_MODELS:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=full_prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2,
                ),
            )
            if response and response.text:
                if model_used is not None:
                    model_used.append(model_name)
                if usage_used is not None:
                    usage_used.append(response.usage_metadata)
                return response.text
        except Exception as e:
            if is_rate_limit_error(e):
                raise e
            continue

    raise ValueError("All Gemini model attempts failed.")


def generate_json(
    prompt: str,
    system_instruction: str = None,
    trace_sink: list | None = None,
    langfuse_trace_id: str | None = None,
    prompt_metadata: dict | None = None,
) -> dict | list:
    """
    Executes JSON generation with multi-key round-robin rotation for Groq primary
    and automatic Gemini multi-key fallback, protected by rate-limit cooldowns.

    `trace_sink`, if given, collects one attempt record per provider/key tried
    (see key_manager.execute_json_generation) — optional, request-level LLM
    observability for the caller's trace (services/trace.py).

    `langfuse_trace_id`, if given (see services/llmops.py::trace_id_for),
    nests this call's Langfuse generation(s) under the caller's own trace.
    """
    return key_manager.execute_json_generation(
        prompt,
        system_instruction,
        trace_sink=trace_sink,
        langfuse_trace_id=langfuse_trace_id,
        prompt_metadata=prompt_metadata,
    )


def generate_json_resilient(
    prompt: str,
    system_instruction: str = None,
    max_attempts: int = 2,
    trace_sink: list | None = None,
    langfuse_trace_id: str | None = None,
    prompt_metadata: dict | None = None,
) -> dict | list:
    """
    generate_json() with a retry for failures *outside* the key sweep.

    key_manager already tries every Groq key, then every Gemini key, once
    each (with rate-limit cooldowns). When that whole sweep fails it raises
    LLMKeysExhausted, which is not retried here — repeating the sweep would
    re-send the same request to keys that just failed (duplicate requests,
    doubled latency) without any realistic chance of a different outcome.
    """
    from .key_manager import LLMKeysExhausted

    return retry_with_backoff(
        generate_json,
        prompt,
        system_instruction,
        trace_sink=trace_sink,
        langfuse_trace_id=langfuse_trace_id,
        prompt_metadata=prompt_metadata,
        max_attempts=max_attempts,
        base_delay=0.3,
        max_delay=2.0,
        non_retryable=(LLMKeysExhausted,),
    )


def _parse_json(text: str) -> dict | list:
    """
    Safely parses JSON output from LLM responses.
    """
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        # Try finding array or object bounds
        obj_match = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
        if obj_match:
            return json.loads(obj_match.group(1))
        raise Exception("Could not parse valid JSON from LLM response.")
