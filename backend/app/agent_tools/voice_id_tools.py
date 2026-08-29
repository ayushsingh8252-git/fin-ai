"""Voice Identification tool — thin, agent-callable wrappers around
services/voice_identification.py's enrollment, identification, and
verification pipelines.

Same BaseMCPConnector contract as every other tool in this directory
(see __init__.py docstring and agent_tools/registry.py): name + description +
JSON-schema input + handler, config-checked and error-normalized.

An audio file must already exist on disk (via the existing POST /voice/enroll
or similar upload endpoint) before these tools can process it — a JSON
tool-call schema isn't a sensible place to carry raw audio bytes.  For
programmatic use, the caller should first save the audio file to a known path
and pass that path as `audio_path`.
"""
from __future__ import annotations

import os
import uuid
from typing import Any, Dict, List

from ..config import settings
from ..database import SessionLocal
from ..mcp.base import BaseMCPConnector, MCPToolError


class VoiceIdentificationConnector(BaseMCPConnector):
    name = "voice_identification"
    display_name = "Voice Identification (Speaker Biometrics)"
    category = "product"
    required_scopes: List[str] = []

    def missing_config(self) -> List[str]:
        # Pinecone is required for 1:N identification at scale.
        # The ECAPA-TDNN model is downloaded on first use (no API key needed).
        missing = []
        if not settings.PINECONE_API_KEY:
            missing.append("PINECONE_API_KEY")
        return missing

    def register_tools(self) -> None:
        # ── Enrollment ─────────────────────────────────────────────────────
        self._add_tool(
            name="enroll_voice",
            description=(
                "Enroll a voice sample for a speaker. The system needs 3–10 audio "
                "samples per speaker to build a robust voiceprint. Each call adds "
                "one sample and reports progress. The audio file must already exist "
                "on disk (e.g. saved by an upload endpoint) — pass the filesystem "
                "path as `audio_path`."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "speaker_id": {
                        "type": "string",
                        "description": "Unique identifier for the speaker (e.g. user ID).",
                    },
                    "speaker_name": {
                        "type": "string",
                        "description": "Human-readable name of the speaker.",
                    },
                    "audio_path": {
                        "type": "string",
                        "description": "Filesystem path to the audio file to enroll.",
                    },
                    "email": {
                        "type": "string",
                        "description": "Optional email address for the speaker.",
                    },
                },
                "required": ["speaker_id", "speaker_name", "audio_path"],
            },
            handler=self._enroll_voice,
        )

        # ── Identification (1:N) ──────────────────────────────────────────
        self._add_tool(
            name="identify_voice",
            description=(
                "Identify a speaker from an audio sample by searching all enrolled "
                "voiceprints (1:N). Runs the full pipeline: VAD → quality check → "
                "ECAPA-TDNN embedding → Pinecone search → re-ranking → threshold/"
                "margin check → replay/AI-voice detection. Returns the matched "
                "speaker or 'unknown'/'denied'. Optionally include a "
                "challenge_phrase for anti-replay verification."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "audio_path": {
                        "type": "string",
                        "description": "Filesystem path to the audio file to identify.",
                    },
                    "challenge_phrase": {
                        "type": "string",
                        "description": (
                            "Optional challenge phrase the speaker was asked to say. "
                            "If provided, the system verifies the spoken words match."
                        ),
                    },
                },
                "required": ["audio_path"],
            },
            handler=self._identify_voice,
        )

        # ── Verification (1:1) ───────────────────────────────────────────
        self._add_tool(
            name="verify_voice",
            description=(
                "Verify an audio sample against a specific speaker's voiceprint "
                "(1:1 comparison). Runs the same anti-spoofing checks as "
                "identify_voice but compares only against the given speaker_id."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "speaker_id": {
                        "type": "string",
                        "description": "The speaker_id to verify against.",
                    },
                    "audio_path": {
                        "type": "string",
                        "description": "Filesystem path to the audio file.",
                    },
                    "challenge_phrase": {
                        "type": "string",
                        "description": "Optional challenge phrase for anti-replay.",
                    },
                },
                "required": ["speaker_id", "audio_path"],
            },
            handler=self._verify_voice,
        )

        # ── Speaker Info ─────────────────────────────────────────────────
        self._add_tool(
            name="get_speaker_info",
            description=(
                "Get information about an enrolled speaker: name, email, "
                "enrollment count, voiceprint status, and enrollment history."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "speaker_id": {
                        "type": "string",
                        "description": "The speaker_id to look up.",
                    },
                },
                "required": ["speaker_id"],
            },
            handler=self._get_speaker_info,
            requires_config=False,  # reads local DB only
        )

        # ── Challenge Phrase ─────────────────────────────────────────────
        self._add_tool(
            name="generate_voice_challenge",
            description=(
                "Generate a random 3-word challenge phrase (e.g. 'blue seven window') "
                "for the speaker to say. Pass this phrase back with the audio in "
                "identify_voice or verify_voice as `challenge_phrase`."
            ),
            input_schema={"type": "object", "properties": {}},
            handler=self._generate_challenge,
            requires_config=False,
        )

    # ── Handlers ─────────────────────────────────────────────────────────────

    def _enroll_voice(self, params: Dict[str, Any]) -> Dict[str, Any]:
        from ..services.voice_identification import enroll_speaker

        speaker_id = (params.get("speaker_id") or "").strip()
        speaker_name = (params.get("speaker_name") or "").strip()
        audio_path = (params.get("audio_path") or "").strip()
        email = (params.get("email") or "").strip() or None

        if not speaker_id:
            raise MCPToolError("`speaker_id` is required", code="validation_error", status_code=400)
        if not speaker_name:
            raise MCPToolError("`speaker_name` is required", code="validation_error", status_code=400)
        if not audio_path or not os.path.isfile(audio_path):
            raise MCPToolError(
                f"`audio_path` does not point to an existing file: {audio_path!r}",
                code="validation_error", status_code=400,
            )

        db = SessionLocal()
        try:
            result = enroll_speaker(speaker_id, speaker_name, audio_path, db, email=email)
            if result.get("status") == "error":
                raise MCPToolError(
                    result.get("message", "Enrollment failed"),
                    code="business_logic_error", status_code=400,
                )
            return result
        finally:
            db.close()

    def _identify_voice(self, params: Dict[str, Any]) -> Dict[str, Any]:
        from ..services.voice_identification import identify_speaker

        audio_path = (params.get("audio_path") or "").strip()
        challenge_phrase = (params.get("challenge_phrase") or "").strip() or None

        if not audio_path or not os.path.isfile(audio_path):
            raise MCPToolError(
                f"`audio_path` does not point to an existing file: {audio_path!r}",
                code="validation_error", status_code=400,
            )

        db = SessionLocal()
        try:
            return identify_speaker(audio_path, db, challenge_phrase=challenge_phrase)
        finally:
            db.close()

    def _verify_voice(self, params: Dict[str, Any]) -> Dict[str, Any]:
        from ..services.voice_identification import verify_speaker

        speaker_id = (params.get("speaker_id") or "").strip()
        audio_path = (params.get("audio_path") or "").strip()
        challenge_phrase = (params.get("challenge_phrase") or "").strip() or None

        if not speaker_id:
            raise MCPToolError("`speaker_id` is required", code="validation_error", status_code=400)
        if not audio_path or not os.path.isfile(audio_path):
            raise MCPToolError(
                f"`audio_path` does not point to an existing file: {audio_path!r}",
                code="validation_error", status_code=400,
            )

        db = SessionLocal()
        try:
            return verify_speaker(speaker_id, audio_path, db, challenge_phrase=challenge_phrase)
        finally:
            db.close()

    def _get_speaker_info(self, params: Dict[str, Any]) -> Dict[str, Any]:
        from ..models import VoicePrint, VoiceEnrollment

        speaker_id = (params.get("speaker_id") or "").strip()
        if not speaker_id:
            raise MCPToolError("`speaker_id` is required", code="validation_error", status_code=400)

        db = SessionLocal()
        try:
            vp = db.query(VoicePrint).filter(VoicePrint.id == speaker_id).first()
            if not vp:
                raise MCPToolError(
                    f"No speaker found with id={speaker_id!r}",
                    code="not_found", status_code=404,
                )

            enrollments = (
                db.query(VoiceEnrollment)
                .filter(VoiceEnrollment.speaker_id == speaker_id)
                .order_by(VoiceEnrollment.created_at.asc())
                .all()
            )

            return {
                "speaker_id": vp.id,
                "speaker_name": vp.speaker_name,
                "email": vp.email,
                "enrollment_count": vp.enrollment_count,
                "status": vp.status,
                "embedding_dimensions": len(vp.embedding) if vp.embedding else 0,
                "created_at": vp.created_at.isoformat() if vp.created_at else None,
                "updated_at": vp.updated_at.isoformat() if vp.updated_at else None,
                "enrollments": [
                    {
                        "enrollment_id": e.id,
                        "audio_quality_score": e.audio_quality_score,
                        "speech_duration_sec": e.speech_duration_sec,
                        "created_at": e.created_at.isoformat() if e.created_at else None,
                    }
                    for e in enrollments
                ],
            }
        finally:
            db.close()

    def _generate_challenge(self, params: Dict[str, Any]) -> Dict[str, Any]:
        from ..services.voice_identification import generate_challenge_phrase
        return {"challenge_phrase": generate_challenge_phrase()}


connector = VoiceIdentificationConnector()
