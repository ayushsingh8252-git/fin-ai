"""LLM key rotation / provider fallback (services/key_manager.py,
llm_service.generate_json_resilient, llm_chains.build_chat_legs).

All provider calls are fakes that count invocations — no network, no real
keys. Checks: primary success, primary failure -> fallback success, rate
limits put keys in cooldown, every key is tried at most once per request
(no duplicate requests, including through the resilient wrapper), and log
output never contains a key."""
import logging

import pytest

from app.services import cost_governance, key_manager as km_mod, llm_chains, llmops
from app.services.key_manager import APIKeyInfo, LLMKeyManager, LLMKeysExhausted

SECRETS = {
    "groq": ["gsk_SECRET_groq_one", "gsk_SECRET_groq_two"],
    "gemini": ["AIza_SECRET_gem_one", "AIza_SECRET_gem_two"],
}


class RateLimited(Exception):
    def __str__(self):
        return "HTTP Error 429: Too Many Requests"


@pytest.fixture()
def km(monkeypatch):
    monkeypatch.setattr(llmops, "get_langfuse", lambda: None)
    monkeypatch.setattr(cost_governance, "record_generation_cost", lambda **k: None)
    m = LLMKeyManager.__new__(LLMKeyManager)
    LLMKeyManager.__init__(m)
    m._keys = {
        p: [APIKeyInfo(p, i + 1, f"{p.upper()}_API_KEY_{i + 1}", secret) for i, secret in enumerate(keys)]
        for p, keys in SECRETS.items()
    }
    m._rr_index = {"groq": 0, "gemini": 0}
    monkeypatch.setattr(m, "_is_redis_cooldown", lambda provider, key: False)
    monkeypatch.setattr(m, "_sync_cooldown_to_redis", lambda provider, key: None)
    return m


def recorder(behaviour):
    """behaviour(api_key) -> str | raises. Returns (fn, calls)."""
    calls = []

    def fn(prompt, system_instruction=None, api_key=None, **_):
        calls.append(api_key)
        return behaviour(api_key)

    return fn, calls


def test_primary_success_uses_one_request(km):
    groq, gcalls = recorder(lambda k: '{"ok": 1}')
    gem, mcalls = recorder(lambda k: pytest.fail("fallback must not run"))
    sink = []
    assert km.execute_json_generation("p", groq_fn=groq, gemini_fn=gem, trace_sink=sink) == {"ok": 1}
    assert len(gcalls) == 1 and mcalls == []
    assert sink[0]["provider"] == "groq" and sink[0]["success"] is True


def test_primary_key_failure_falls_back_to_next_key(km):
    def b(k):
        if k == SECRETS["groq"][0]:
            raise ConnectionError("upstream 503")
        return '{"ok": 2}'

    groq, gcalls = recorder(b)
    gem, mcalls = recorder(lambda k: pytest.fail("gemini must not run"))
    assert km.execute_json_generation("p", groq_fn=groq, gemini_fn=gem) == {"ok": 2}
    assert gcalls == SECRETS["groq"]  # each key once, in order
    assert mcalls == []


def test_groq_rate_limited_falls_back_to_gemini_and_cools_down(km):
    def limited(k):
        raise RateLimited()

    groq, gcalls = recorder(limited)
    gem, mcalls = recorder(lambda k: '{"provider": "gemini"}')
    assert km.execute_json_generation("p", groq_fn=groq, gemini_fn=gem) == {"provider": "gemini"}
    assert sorted(gcalls) == sorted(SECRETS["groq"])  # no key hit twice
    assert len(mcalls) == 1
    assert all(not k.is_available() for k in km._keys["groq"])

    # While cooling down, the next request goes straight to Gemini.
    groq2, g2 = recorder(lambda k: pytest.fail("cooled-down key used"))
    km.execute_json_generation("p", groq_fn=groq2, gemini_fn=gem)
    assert g2 == []


def test_bad_json_counts_as_failure_and_moves_on(km):
    groq, gcalls = recorder(lambda k: "not json at all")
    gem, mcalls = recorder(lambda k: '{"ok": 3}')
    assert km.execute_json_generation("p", groq_fn=groq, gemini_fn=gem) == {"ok": 3}
    assert len(gcalls) == 2 and len(mcalls) == 1


def test_all_fail_raises_exhausted_once_each_and_no_secret_in_logs(km, caplog):
    def boom(k):
        raise ValueError("model_not_found")

    groq, gcalls = recorder(boom)
    gem, mcalls = recorder(boom)
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(LLMKeysExhausted) as ei:
            km.execute_json_generation("p", groq_fn=groq, gemini_fn=gem)
    assert len(gcalls) == 2 and len(mcalls) == 2
    blob = caplog.text + str(ei.value)
    for secrets in SECRETS.values():
        for s in secrets:
            assert s not in blob


def test_resilient_wrapper_does_not_repeat_exhausted_sweep(km, monkeypatch):
    from app.services import llm_service

    def boom(k):
        raise ValueError("server error")

    groq, gcalls = recorder(boom)
    gem, mcalls = recorder(boom)
    monkeypatch.setattr(llm_service, "key_manager", km, raising=False)
    monkeypatch.setattr(
        llm_service, "generate_json",
        lambda prompt, system_instruction=None, **kw: km.execute_json_generation(prompt, system_instruction, groq_fn=groq, gemini_fn=gem),
    )
    with pytest.raises(LLMKeysExhausted):
        llm_service.generate_json_resilient("p", max_attempts=3)
    assert len(gcalls) == 2 and len(mcalls) == 2  # one sweep, not three


def test_resilient_wrapper_still_retries_transient_non_sweep_errors(monkeypatch):
    from app.services import llm_service

    n = {"calls": 0}

    def flaky(prompt, system_instruction=None, **kw):
        n["calls"] += 1
        if n["calls"] == 1:
            raise ConnectionError("DNS blip before any key was tried")
        return {"ok": True}

    monkeypatch.setattr(llm_service, "generate_json", flaky)
    assert llm_service.generate_json_resilient("p", max_attempts=2) == {"ok": True}
    assert n["calls"] == 2


def test_langchain_legs_cover_pools_without_internal_retries(km, monkeypatch):
    monkeypatch.setattr(llm_chains, "key_manager", km)
    legs = llm_chains.build_chat_legs(0.2)
    assert legs, "pooled keys must produce legs"
    assert all(getattr(leg, "max_retries", None) == 0 for leg in legs)
    assert len(legs) <= llm_chains.MAX_LEGS
    kinds = [type(leg).__name__ for leg in legs]
    assert kinds[0] == "ChatGroq" and "ChatGoogleGenerativeAI" in kinds

    km._keys["groq"][0].set_cooldown(60)
    legs2 = llm_chains.build_chat_legs(0.2)
    assert sum(type(leg).__name__ == "ChatGroq" for leg in legs2) < sum(k == "ChatGroq" for k in kinds)


def test_no_keys_is_an_explicit_error(monkeypatch):
    empty = LLMKeyManager.__new__(LLMKeyManager)
    LLMKeyManager.__init__(empty)
    empty._keys = {"groq": [], "gemini": []}
    monkeypatch.setattr(llm_chains, "key_manager", empty)
    with pytest.raises(RuntimeError, match="No LLM provider configured"):
        llm_chains.structured_chain(None, dict, 0.2)
