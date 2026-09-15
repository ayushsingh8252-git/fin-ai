from unittest.mock import patch

from app.services.llmops import get_managed_prompt


def test_managed_prompt_uses_local_fallback_without_langfuse():
    with patch("app.services.llmops.get_langfuse", return_value=None):
        prompt = get_managed_prompt("screening-resume-profile", "local instruction", label="production")

    assert prompt.text == "local instruction"
    assert prompt.metadata == {
        "prompt_name": "screening-resume-profile",
        "prompt_label": "production",
        "prompt_version": None,
        "prompt_source": "local_fallback",
    }


def test_managed_prompt_records_langfuse_version():
    compiled_with = {}

    class Prompt:
        version = 7

        @staticmethod
        def compile(**variables):
            compiled_with.update(variables)
            return "managed instruction"

    class Langfuse:
        @staticmethod
        def get_prompt(*args, **kwargs):
            return Prompt()

    with patch("app.services.llmops.get_langfuse", return_value=Langfuse()):
        prompt = get_managed_prompt(
            "fraud-identity-extraction",
            "fallback",
            label="candidate",
            variables={"query": "leave policy"},
        )

    assert prompt.text == "managed instruction"
    assert prompt.metadata["prompt_version"] == 7
    assert prompt.metadata["prompt_source"] == "langfuse"
    assert compiled_with == {"query": "leave policy"}
