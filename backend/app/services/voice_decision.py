"""Central Voice Decision Engine.

Aggregates all multi-modal biometric and security verification signals:
- Speaker Biometric Match Score
- Top-1 vs Top-2 Candidate Score Margin
- Audio Quality & VAD Gate
- Acoustic Replay Attack Detection
- AI / Synthetic / Voice-Clone Detection
- Spoken Challenge-Response Verification

Enforces the central security policy:
  bad audio                   -> RETRY
  replay detected             -> DENY
  synthetic detected          -> DENY
  challenge failed            -> DENY
  speaker score < threshold   -> UNKNOWN (1:N) / DENY (1:1)
  score margin < threshold    -> UNCERTAIN
  all checks pass             -> OPEN
"""
from __future__ import annotations

from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, Any, Optional

from .voice_security.base import SpoofLabel


class DecisionType(str, Enum):
    OPEN = "OPEN"
    DENY = "DENY"
    RETRY = "RETRY"
    UNKNOWN = "UNKNOWN"
    UNCERTAIN = "UNCERTAIN"


@dataclass
class VoiceDecision:
    decision: DecisionType
    speaker_id: Optional[str] = None
    speaker_name: Optional[str] = None
    score: float = 0.0
    margin: float = 0.0
    quality_usable: bool = True
    spoof_label: str = "live"
    challenge_passed: Optional[bool] = None
    reason: str = "ok"
    message: str = "Verification successful."
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "decision": self.decision.value if isinstance(self.decision, DecisionType) else str(self.decision),
            "speaker_id": self.speaker_id,
            "speaker_name": self.speaker_name,
            "score": round(self.score, 4),
            "margin": round(self.margin, 4),
            "quality_usable": self.quality_usable,
            "spoof_label": self.spoof_label,
            "challenge_passed": self.challenge_passed,
            "reason": self.reason,
            "message": self.message,
            "details": self.details,
        }


def authenticate(
    speaker_score: float,
    score_margin: float,
    quality_usable: bool,
    spoof_result: Optional[Dict[str, Any]] = None,
    challenge_result: Optional[Dict[str, Any]] = None,
    calibrated_threshold: float = 0.70,
    calibrated_margin: float = 0.10,
    speaker_id: Optional[str] = None,
    speaker_name: Optional[str] = None,
    is_1_to_1: bool = False,
) -> VoiceDecision:
    """Central decision engine function fusing all biometric and security signals."""
    spoof_info = spoof_result or {}
    spoof_label_str = spoof_info.get("overall_label", "live")
    is_spoof = spoof_info.get("is_spoof", False)
    replay_data = spoof_info.get("replay", {})
    synthetic_data = spoof_info.get("synthetic", {})

    # 1. Quality Check
    if not quality_usable:
        return VoiceDecision(
            decision=DecisionType.RETRY,
            speaker_id=speaker_id,
            speaker_name=speaker_name,
            score=speaker_score,
            margin=score_margin,
            quality_usable=False,
            spoof_label=spoof_label_str,
            reason="low_audio_quality",
            message="Audio quality insufficient for reliable biometrics. Please speak clearly into the microphone.",
            details={"quality_usable": False},
        )

    # 2. Replay Detection
    if replay_data.get("label") == SpoofLabel.REPLAY.value or replay_data.get("is_replay"):
        return VoiceDecision(
            decision=DecisionType.DENY,
            speaker_id=speaker_id,
            speaker_name=speaker_name,
            score=speaker_score,
            margin=score_margin,
            quality_usable=True,
            spoof_label=SpoofLabel.REPLAY.value,
            reason="replay_detected",
            message="Replay attack detected. Loudspeaker acoustic playback is prohibited.",
            details={"replay": replay_data},
        )

    # 3. Synthetic / AI Voice Detection
    if synthetic_data.get("label") == SpoofLabel.SYNTHETIC.value or synthetic_data.get("is_synthetic"):
        return VoiceDecision(
            decision=DecisionType.DENY,
            speaker_id=speaker_id,
            speaker_name=speaker_name,
            score=speaker_score,
            margin=score_margin,
            quality_usable=True,
            spoof_label=SpoofLabel.SYNTHETIC.value,
            reason="synthetic_detected",
            message="Synthetic or AI-generated voice detected. Only live human voices are accepted.",
            details={"synthetic": synthetic_data},
        )

    # 4. Challenge-Response Check (if applicable)
    challenge_passed = None
    if challenge_result is not None:
        challenge_passed = bool(challenge_result.get("match", False))
        if not challenge_passed:
            return VoiceDecision(
                decision=DecisionType.DENY,
                speaker_id=speaker_id,
                speaker_name=speaker_name,
                score=speaker_score,
                margin=score_margin,
                quality_usable=True,
                spoof_label=spoof_label_str,
                challenge_passed=False,
                reason="challenge_failed",
                message=f"Challenge phrase verification failed. Heard '{challenge_result.get('spoken', '')}' instead of expected phrase.",
                details={"challenge": challenge_result},
            )

    # 5. Biometric Similarity Threshold
    if speaker_score < calibrated_threshold:
        fail_decision = DecisionType.DENY if is_1_to_1 else DecisionType.UNKNOWN
        return VoiceDecision(
            decision=fail_decision,
            speaker_id=speaker_id,
            speaker_name=speaker_name,
            score=speaker_score,
            margin=score_margin,
            quality_usable=True,
            spoof_label=spoof_label_str,
            challenge_passed=challenge_passed,
            reason="below_threshold",
            message=f"Voice similarity score {speaker_score:.4f} is below calibrated threshold {calibrated_threshold:.4f}.",
            details={"threshold": calibrated_threshold},
        )

    # 6. Score Margin Check (for 1:N or ambiguous candidates)
    if not is_1_to_1 and score_margin < calibrated_margin:
        return VoiceDecision(
            decision=DecisionType.UNCERTAIN,
            speaker_id=speaker_id,
            speaker_name=speaker_name,
            score=speaker_score,
            margin=score_margin,
            quality_usable=True,
            spoof_label=spoof_label_str,
            challenge_passed=challenge_passed,
            reason="insufficient_margin",
            message=f"Ambiguous match: top score margin {score_margin:.4f} is below required margin {calibrated_margin:.4f}. Please retry with clearer audio.",
            details={"margin_threshold": calibrated_margin},
        )

    # 7. ALL CHECKS PASS -> OPEN
    return VoiceDecision(
        decision=DecisionType.OPEN,
        speaker_id=speaker_id,
        speaker_name=speaker_name,
        score=speaker_score,
        margin=score_margin,
        quality_usable=True,
        spoof_label=spoof_label_str,
        challenge_passed=challenge_passed,
        reason="ok",
        message=f"Authenticated successfully as {speaker_name or speaker_id}.",
        details={
            "calibrated_threshold": calibrated_threshold,
            "calibrated_margin": calibrated_margin,
        },
    )
