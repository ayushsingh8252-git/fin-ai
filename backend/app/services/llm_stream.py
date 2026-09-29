"""Native token streaming for plain-text replies (the voice interview).

Same providers, keys, rotation and cooldowns as llm_service/key_manager's
JSON path — Groq's OpenAI-compatible endpoint first (SSE, `stream: true`),
Gemini's `generate_content_stream` as the fallback — but yields text deltas
as they arrive, so the interviewer's first sentence can go to TTS while the
rest is still being generated.

Failover happens only BEFORE the first delta: once any text has been yielded
it may already be playing, so a mid-stream failure ends the reply (what was
said stays said) instead of restarting on another provider.
"""

import asyncio
import json
import logging
import time
from typing import AsyncIterator, Optional

import httpx

from .key_manager import is_rate_limit_error, key_manager
from .model_config import GEMINI_MODELS, GROQ_MODELS, XAI_GROK_MODELS

logger = logging.getLogger(__name__)

# One pooled client per process. Measured on the dev box: the first request
# of a fresh connection took ~5.6 s to first token (DNS + TLS) vs ~0.7-1.6 s
# warm. httpx's default keep-alive (5 s) would drop the connection while the
# candidate is answering, so nearly every turn paid that again — hence the
# long keep-alive and the startup warm_up() below.
_http: Optional[httpx.AsyncClient] = None
CONNECT_TIMEOUT_S = 5.0
FIRST_TOKEN_TIMEOUT_S = 15.0
KEEPALIVE_S = 120.0


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None or _http.is_closed:
        _http = httpx.AsyncClient(
            timeout=httpx.Timeout(FIRST_TOKEN_TIMEOUT_S, connect=CONNECT_TIMEOUT_S),
            limits=httpx.Limits(max_keepalive_connections=10, keepalive_expiry=KEEPALIVE_S),
        )
    return _http


async def warm_up() -> None:
    """Open the pooled connection to the primary provider ahead of the first
    interview turn (a cheap authenticated GET /models). Never raises."""
    try:
        key = await asyncio.to_thread(key_manager.get_next_key, "groq")
        if key is None or key.api_key.startswith("xai-"):
            return
        t0 = time.perf_counter()
        r = await _client().get("https://api.groq.com/openai/v1/models",
                                headers={"Authorization": f"Bearer {key.api_key}"})
        print(f"[LLM stream] provider connection warmed status={r.status_code} ms={(time.perf_counter() - t0) * 1000:.0f}")
    except Exception as e:
        print(f"[LLM stream] warm-up skipped: {type(e).__name__}")


class StreamFailed(RuntimeError):
    """No provider produced any text."""


class _HTTPStatusError(RuntimeError):
    def __init__(self, status_code: int, body: str):
        super().__init__(f"HTTP {status_code}: {body[:200]}")
        self.status_code = status_code


async def _groq_stream(api_key: str, model: str, system: str, prompt: str, usage_out: list) -> AsyncIterator[str]:
    base_url = ("https://api.x.ai/v1/chat/completions" if api_key.startswith("xai-")
                else "https://api.groq.com/openai/v1/chat/completions")
    body = {
        "model": model,
        "stream": True,
        "temperature": 0.3,
        "stream_options": {"include_usage": True},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
    }
    if model.startswith("openai/gpt-oss"):
        # gpt-oss reasons before answering; "low" keeps a one-question reply
        # from spending its first second thinking (measured ~0.8 vs ~1.0 s TTFT).
        body["reasoning_effort"] = "low"
    headers = {"Authorization": f"Bearer {api_key}", "User-Agent": "AI-Policy-Rule-Engine/1.0"}
    async with _client().stream("POST", base_url, json=body, headers=headers) as resp:
        if resp.status_code != 200:
            raise _HTTPStatusError(resp.status_code, (await resp.aread()).decode("utf-8", "replace"))
        async for line in resp.aiter_lines():
            if not line.startswith("data: "):
                continue
            data = line[6:].strip()
            if data == "[DONE]":
                return
            event = json.loads(data)
            usage = event.get("usage") or (event.get("x_groq") or {}).get("usage")
            if usage:
                usage_out.append(usage)
            for choice in event.get("choices") or []:
                delta = (choice.get("delta") or {}).get("content")
                if delta:
                    yield delta


async def _gemini_stream(api_key: str, model: str, system: str, prompt: str, usage_out: list) -> AsyncIterator[str]:
    from google.genai import types

    from .llm_service import _get_gemini_client

    client = _get_gemini_client(api_key)
    stream = await client.aio.models.generate_content_stream(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(system_instruction=system, temperature=0.3),
    )
    async for chunk in stream:
        if getattr(chunk, "usage_metadata", None):
            usage_out.append(chunk.usage_metadata)
        if chunk.text:
            yield chunk.text


def _record_cost(provider: str, model: str, usage, trace_id: Optional[str]) -> None:
    try:
        from .cost_governance import record_generation_cost
        from .llmops import calculate_cost_details, normalize_gemini_usage, normalize_openai_usage

        usage_details = normalize_openai_usage(usage) if provider == "groq" else normalize_gemini_usage(usage)
        record_generation_cost(trace_id=trace_id, provider=provider, model=model, usage_details=usage_details,
                               cost_details=calculate_cost_details(model, usage_details))
    except Exception as e:  # accounting must never break a live interview turn
        logger.warning("[LLM stream] cost recording failed: %s", e)


async def stream_text(
    prompt: str,
    system_instruction: str,
    *,
    timings: Optional[dict] = None,
    langfuse_trace_id: Optional[str] = None,
) -> AsyncIterator[str]:
    """Yields reply text deltas from the first provider/key/model that
    answers. `timings`, if given, gets `llm_first_token` (perf_counter) and
    `provider`/`model` filled in. Cancelling the consumer closes the HTTP
    stream (async generator finalization), so generation really stops."""
    attempts = []
    for provider, models, stream_fn in (
        ("groq", None, _groq_stream),
        ("gemini", GEMINI_MODELS, _gemini_stream),
    ):
        tried: set = set()
        while True:
            # In a thread: get_next_key consults Redis synchronously, and
            # with Redis unreachable that's a ~4 s connect timeout every 30 s
            # (measured) — inline, it froze the event loop and with it every
            # other live interview socket.
            key = await asyncio.to_thread(key_manager.get_next_key, provider, tried)
            if key is None:
                break
            tried.add(key.label)
            candidates = models or (XAI_GROK_MODELS if key.api_key.startswith("xai-") else GROQ_MODELS)
            for model in candidates:
                usage: list = []
                started = time.perf_counter()
                emitted = False
                try:
                    gen = stream_fn(key.api_key, model, system_instruction, prompt, usage)
                    try:
                        async for delta in gen:
                            if not emitted:
                                emitted = True
                                if timings is not None:
                                    timings["llm_first_token"] = time.perf_counter()
                                    timings["provider"], timings["model"] = provider, model
                            yield delta
                    finally:
                        await gen.aclose()
                    if emitted:
                        _record_cost(provider, model, usage[-1] if usage else None, langfuse_trace_id)
                        return
                    attempts.append(f"{provider}/{model}: empty reply")
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    if emitted:
                        # Already speaking: end the reply here, don't restart it elsewhere.
                        logger.warning("[LLM stream] %s/%s failed mid-stream after %.0f ms: %s",
                                       provider, model, (time.perf_counter() - started) * 1000, type(e).__name__)
                        return
                    attempts.append(f"{provider}/{key.label}/{model}: {type(e).__name__}")
                    if is_rate_limit_error(e):
                        key_manager.mark_cooldown(key, error_type=f"{type(e).__name__}: 429/Quota")
                        break  # this key is throttled for every model — next key
                    continue  # model-specific failure (e.g. retired model) — next model
    raise StreamFailed("No LLM provider produced a reply. " + "; ".join(attempts[-6:]))
