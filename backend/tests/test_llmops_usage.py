import os
import unittest
from unittest.mock import patch

from app.services.llmops import (
    calculate_cost_details,
    normalize_gemini_usage,
    normalize_openai_usage,
)


class TestLLMOpsUsage(unittest.TestCase):
    def test_normalizes_openai_compatible_usage(self):
        usage = normalize_openai_usage({
            "prompt_tokens": 120,
            "completion_tokens": 30,
            "prompt_tokens_details": {"cached_tokens": 20},
        })
        self.assertEqual(usage, {
            "input_tokens": 120,
            "output_tokens": 30,
            "cache_read_input_tokens": 20,
        })

    def test_normalizes_gemini_usage(self):
        usage = normalize_gemini_usage({
            "prompt_token_count": 100,
            "candidates_token_count": 25,
            "cached_content_token_count": 10,
        })
        self.assertEqual(usage["input_tokens"], 100)
        self.assertEqual(usage["output_tokens"], 25)
        self.assertEqual(usage["cache_read_input_tokens"], 10)

    def test_cost_uses_configured_rate_card(self):
        rates = '{"test-model":{"input":2.0,"output":8.0,"cache_read_input":0.5}}'
        with patch.dict(os.environ, {"LLM_COST_RATES_JSON": rates}, clear=False):
            # Settings is instantiated at import time, so patch its resolved value.
            with patch("app.services.llmops.settings.LLM_COST_RATES_JSON", rates):
                cost = calculate_cost_details("test-model", {
                    "input_tokens": 500_000,
                    "output_tokens": 100_000,
                    "cache_read_input_tokens": 20_000,
                })
        self.assertEqual(cost, {
            "input": 0.96,
            "output": 0.8,
            "cache_read_input": 0.01,
        })

    def test_missing_rate_does_not_invent_cost(self):
        with patch("app.services.llmops.settings.LLM_COST_RATES_JSON", "{}"):
            self.assertIsNone(calculate_cost_details("unknown", {"input_tokens": 10, "output_tokens": 2}))


if __name__ == "__main__":
    unittest.main()
