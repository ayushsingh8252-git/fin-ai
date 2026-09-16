"""Shared rate limiter for LLM/compute-calling endpoints — every such route
was previously unbounded, meaning a scripted client loop could run up real
Groq/Gemini/Sarvam/Tavily cost with no ceiling. Keyed by client IP (not by
user) so it also covers the two intentionally-public, unauthenticated routers
(query.py's /query, audio.py's /transcribe + /tts) that anonymous marketing-
site visitors can reach.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
