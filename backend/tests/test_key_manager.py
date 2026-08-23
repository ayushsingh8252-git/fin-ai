import os
import time
import unittest
from unittest.mock import patch, MagicMock

from app.services.key_manager import LLMKeyManager, APIKeyInfo, is_rate_limit_error


class TestLLMKeyManager(unittest.TestCase):

    def setUp(self):
        # Clear env vars before each test to isolate discovery tests
        self.env_patcher = patch.dict(os.environ, {}, clear=True)
        self.env_patcher.start()

    def tearDown(self):
        self.env_patcher.stop()

    def test_missing_keys_ignored(self):
        """Verify missing/empty keys are ignored during key discovery."""
        os.environ["GROQ_API_KEY_1"] = "gsk_key1"
        os.environ["GROQ_API_KEY_2"] = ""  # empty, should be ignored
        os.environ["GROQ_API_KEY_4"] = "  "  # whitespace, should be ignored
        os.environ["GROQ_API_KEY_5"] = "gsk_key5"

        km = LLMKeyManager(cooldown_seconds=60)
        groq_keys = km._keys["groq"]

        self.assertEqual(len(groq_keys), 2)
        self.assertEqual(groq_keys[0].label, "GROQ_API_KEY_1")
        self.assertEqual(groq_keys[0].api_key, "gsk_key1")
        self.assertEqual(groq_keys[1].label, "GROQ_API_KEY_5")
        self.assertEqual(groq_keys[1].api_key, "gsk_key5")

    def test_normal_key_rotation(self):
        """Verify round-robin selection across normal requests."""
        os.environ["GROQ_API_KEY_1"] = "gsk_key1"
        os.environ["GROQ_API_KEY_2"] = "gsk_key2"
        os.environ["GROQ_API_KEY_3"] = "gsk_key3"

        km = LLMKeyManager(cooldown_seconds=60)

        key_a = km.get_next_key("groq")
        key_b = km.get_next_key("groq")
        key_c = km.get_next_key("groq")
        key_d = km.get_next_key("groq")

        self.assertEqual(key_a.api_key, "gsk_key1")
        self.assertEqual(key_b.api_key, "gsk_key2")
        self.assertEqual(key_c.api_key, "gsk_key3")
        self.assertEqual(key_d.api_key, "gsk_key1")  # Loops back in round-robin

    def test_429_moves_to_next_key_and_cooldown(self):
        """Verify 429 error marks key in cooldown and immediately uses next key."""
        os.environ["GROQ_API_KEY_1"] = "gsk_key1"
        os.environ["GROQ_API_KEY_2"] = "gsk_key2"

        km = LLMKeyManager(cooldown_seconds=60)

        # Mock Groq calls: key 1 returns 429 error, key 2 succeeds
        def mock_groq(prompt, system_instruction=None, api_key=None):
            if api_key == "gsk_key1":
                raise Exception("429 Too Many Requests: Rate limit exceeded")
            return '{"status": "ok"}'

        result = km.execute_json_generation(
            prompt="test",
            groq_fn=mock_groq,
            gemini_fn=MagicMock(),
            parse_fn=lambda x: {"status": "ok"},
        )

        self.assertEqual(result, {"status": "ok"})
        # Verify key 1 is now in cooldown
        key1 = km._keys["groq"][0]
        self.assertFalse(key1.is_available())
        # Next request uses key 2
        next_key = km.get_next_key("groq")
        self.assertEqual(next_key.api_key, "gsk_key2")

    def test_all_groq_keys_fail_falls_back_to_gemini(self):
        """Verify fallback to Gemini when all Groq keys fail."""
        os.environ["GROQ_API_KEY_1"] = "gsk_groq1"
        os.environ["GEMINI_API_KEY_1"] = "gemini_key1"

        km = LLMKeyManager(cooldown_seconds=60)

        def mock_groq_fail(prompt, system_instruction=None, api_key=None):
            raise Exception("Groq Service Unavailable")

        def mock_gemini_success(prompt, system_instruction=None, api_key=None):
            self.assertEqual(api_key, "gemini_key1")
            return '{"provider": "gemini"}'

        result = km.execute_json_generation(
            prompt="test",
            groq_fn=mock_groq_fail,
            gemini_fn=mock_gemini_success,
            parse_fn=lambda x: {"provider": "gemini"},
        )

        self.assertEqual(result, {"provider": "gemini"})

    def test_cooldown_and_retry(self):
        """Verify key becomes available again after cooldown duration expires."""
        os.environ["GROQ_API_KEY_1"] = "gsk_key1"
        km = LLMKeyManager(cooldown_seconds=10)

        key1 = km._keys["groq"][0]
        now = time.time()
        key1.set_cooldown(seconds=10, now=now)

        # In cooldown
        self.assertFalse(key1.is_available(now=now + 5))
        # After cooldown
        self.assertTrue(key1.is_available(now=now + 11))


if __name__ == "__main__":
    unittest.main()
