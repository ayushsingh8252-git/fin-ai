import os
import sys
from pathlib import Path

# Load .env from apps/AI-Policy-Rule-Engine/.env
env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                parts = line.split("=", 1)
                os.environ[parts[0].strip()] = parts[1].strip()

from app.services.key_manager import key_manager
from app.services.llm_service import _call_grok_groq_api, _call_gemini_api

print("=== LIVE API KEY VERIFICATION ===")
key_manager.refresh_keys()

print(f"\nDiscovered Groq Keys: {len(key_manager._keys['groq'])}")
for k in key_manager._keys['groq']:
    print(f" - [{k.label}] Index: {k.index}")

print(f"\nDiscovered Gemini Keys: {len(key_manager._keys['gemini'])}")
for k in key_manager._keys['gemini']:
    print(f" - [{k.label}] Index: {k.index}")

results = {}

# Test Groq keys
print("\n--- Testing Groq API Keys ---")
for k in key_manager._keys['groq']:
    print(f"Testing {k.label}...")
    try:
        res = _call_grok_groq_api("Say OK in JSON format: {\"status\": \"OK\"}", api_key=k.api_key)
        print(f"  [SUCCESS] {k.label}")
        results[k.label] = ("SUCCESS", res.strip().replace("\n", " ")[:60])
    except Exception as e:
        print(f"  [FAILED] {k.label}: {e}")
        results[k.label] = ("FAILED", str(e))

# Test Gemini keys
print("\n--- Testing Gemini API Keys ---")
for k in key_manager._keys['gemini']:
    print(f"Testing {k.label}...")
    try:
        res = _call_gemini_api("Say OK in JSON format: {\"status\": \"OK\"}", api_key=k.api_key)
        print(f"  [SUCCESS] {k.label}")
        results[k.label] = ("SUCCESS", res.strip().replace("\n", " ")[:60])
    except Exception as e:
        print(f"  [FAILED] {k.label}: {e}")
        results[k.label] = ("FAILED", str(e))

print("\n=== SUMMARY ===")
for label, (status, detail) in results.items():
    print(f"{label:20s}: {status} -> {detail}")
