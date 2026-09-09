"""
Resume Authenticity Check — catches classic embellishment AND the newer wave
of AI-generated/templated applications, by combining four signals into one
weighted ensemble (never letting any single weak signal drive the verdict
alone):

  1. Logic checks (deterministic, no ML) — employment date ranges that
     overlap, future-dated roles, experience claimed vs. experience the
     listed dates actually add up to, employment starting before graduation.
  2. Employer/domain cross-reference (deterministic) — does a claimed work
     email's domain plausibly belong to the claimed employer.
  3. File metadata (reused from fraud_metadata.py) — editing-tool fingerprint
     and creation/modification date mismatch, same as every other document
     type in this pipeline.
  4. Embedding similarity — the resume's embedding (same BAAI/bge-base-en-v1.5
     model already used elsewhere in this app) compared against every other
     resume embedding on file; a near-duplicate submitted under a different
     name is the signature of a templated/mass-produced application.
  5. AI-text classifier (LangChain, fraud_llm.classify_ai_text) — an LLM's
     estimate of how "AI-generated" the prose reads. Explicitly the lowest
     weighted and least trusted signal: a hard rule below prevents it from
     single-handedly failing an otherwise-clean resume.
"""

import re
from datetime import date, datetime

import numpy as np

from ..database import SessionLocal
from ..models import IdentityRecord
from . import detection, fraud_llm, fraud_metadata
from .llmops import trace_id_for

LOGIC_WEIGHT = 0.30
DOMAIN_WEIGHT = 0.20
METADATA_WEIGHT = 0.15
EMBEDDING_WEIGHT = 0.20
AI_TEXT_WEIGHT = 0.15

# Calibrated empirically against BAAI/bge-base-en-v1.5 (the model this app
# already uses elsewhere — see detection.py): two genuinely different resumes
# in the same job domain land around ~0.6 cosine similarity; a templated
# resume with only the name/contact swapped lands around ~0.85-0.90; a truly
# identical body is ~1.0. 0.80 sits with margin in the gap between those.
EMBEDDING_TEMPLATE_THRESHOLD = 0.80
OVERLAP_TOLERANCE_DAYS = 45  # short employment-transition overlaps are normal, not evidence of fraud

PERSONAL_EMAIL_DOMAINS = {
    "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com",
    "protonmail.com", "proton.me", "aol.com", "live.com", "rediffmail.com", "yandex.com",
}

MIN_TEXT_CHARS = 80


# ─────────────────────────────────────────────────────────────────────────
# 1. Logic checks
# ─────────────────────────────────────────────────────────────────────────


def _parse_partial_date(raw: str | None) -> date | None:
    if not raw:
        return None
    raw = raw.strip()
    if raw.lower() in ("present", "current", "ongoing", "now", "till date", "to date"):
        return date.today()
    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _resume_logic_checks(extracted: "fraud_llm.ExtractedIdentity") -> list[dict]:
    checks = []
    parsed = []
    for e in extracted.employers:
        start = _parse_partial_date(e.start_date)
        end = _parse_partial_date(e.end_date) or (date.today() if start else None)
        if start:
            parsed.append((e.employer, start, end))
    parsed.sort(key=lambda t: t[1])

    if len(parsed) >= 2:
        overlap = None
        for i in range(len(parsed)):
            for j in range(i + 1, len(parsed)):
                name_i, s_i, e_i = parsed[i]
                name_j, s_j, e_j = parsed[j]
                overlap_days = (min(e_i, e_j) - max(s_i, s_j)).days
                if overlap_days > OVERLAP_TOLERANCE_DAYS:
                    overlap = (name_i, name_j, overlap_days)
                    break
            if overlap:
                break
        checks.append({
            "rule": "employment date ranges do not significantly overlap",
            "passed": overlap is None,
            "detail": f"'{overlap[0]}' and '{overlap[1]}' overlap by {overlap[2]} days" if overlap else f"{len(parsed)} employer(s) checked, no significant overlap.",
        })

    if parsed:
        future = [name for name, start, _ in parsed if start > date.today()]
        checks.append({
            "rule": "no employment start dates are in the future",
            "passed": not future,
            "detail": f"'{future[0]}' has a future start date." if future else "All start dates are in the past.",
        })

    if extracted.graduation_year and parsed:
        earliest_start = parsed[0][1]
        ok = earliest_start.year >= extracted.graduation_year - 1  # allow a year for internships
        checks.append({
            "rule": "earliest employment is not before graduation",
            "passed": ok,
            "detail": f"Graduated {extracted.graduation_year}, earliest role starts {earliest_start.isoformat()}.",
        })

    if extracted.claimed_total_experience_years is not None and parsed:
        computed_years = sum((end - start).days for _, start, end in parsed) / 365.25
        claimed = extracted.claimed_total_experience_years
        ok = abs(computed_years - claimed) <= max(1.5, claimed * 0.35)
        checks.append({
            "rule": "claimed total experience roughly matches listed employment durations",
            "passed": ok,
            "detail": f"Claimed {claimed:g} yrs vs. {computed_years:.1f} yrs computed from listed roles.",
        })

    return checks


# ─────────────────────────────────────────────────────────────────────────
# 2. Employer / domain cross-reference
# ─────────────────────────────────────────────────────────────────────────


def _domain_matches_employer(domain: str, employer: str) -> bool:
    domain_root = re.split(r"\.", domain.lower())[0]
    employer_tokens = [t for t in re.findall(r"[a-z]+", employer.lower()) if len(t) > 2]
    return any(tok in domain_root or domain_root in tok for tok in employer_tokens)


def _check_domain_crossref(employers: list, email: str | None) -> tuple[list[dict], list[str]]:
    checks, flags = [], []
    for e in employers:
        if not e.email_domain_used:
            continue
        domain = e.email_domain_used.lower().strip()
        if domain in PERSONAL_EMAIL_DOMAINS:
            checks.append({"rule": f"work email domain matches claimed employer ({e.employer})", "passed": True, "detail": f"{domain} is a personal provider — normal for contact info, not evaluated against employer name."})
            continue
        matches = _domain_matches_employer(domain, e.employer)
        checks.append({"rule": f"work email domain matches claimed employer ({e.employer})", "passed": matches, "detail": f"Domain '{domain}' {'resembles' if matches else 'does not resemble'} '{e.employer}'."})
        if not matches:
            flags.append(f"Email domain '{domain}' doesn't match claimed employer '{e.employer}'.")
    return checks, flags


# ─────────────────────────────────────────────────────────────────────────
# 4. Embedding similarity (templated / mass-produced resume detection)
# ─────────────────────────────────────────────────────────────────────────


def _resume_embedding(text: str) -> list[float] | None:
    try:
        model = detection.get_embedding_model()
        vec = model.encode([text[:4000]])[0]
        return [round(float(x), 5) for x in vec.tolist()]
    except Exception as e:
        print(f"[Resume Authenticity] embedding failed: {e}")
        return None


def _check_embedding_similarity(db, scan_id: str, candidate_name: str | None, embedding: list[float] | None) -> tuple[dict, list[str], float]:
    if embedding is None:
        return {"available": False}, [], 85.0  # neutral — feature unavailable, not evidence either way

    others = (
        db.query(IdentityRecord)
        .filter(IdentityRecord.id != scan_id, IdentityRecord.resume_embedding.isnot(None))
        .limit(500)
        .all()
    )
    own_name = (candidate_name or "").strip().lower()
    vec = np.array(embedding)
    vec_norm = np.linalg.norm(vec)

    best = None
    for rec in others:
        if own_name and (rec.full_name or "").strip().lower() == own_name:
            continue  # the same person re-uploading their own resume isn't a "shared template"
        other = np.array(rec.resume_embedding)
        other_norm = np.linalg.norm(other)
        if vec_norm == 0 or other_norm == 0:
            continue
        sim = float(np.dot(vec, other) / (vec_norm * other_norm))
        if best is None or sim > best[1]:
            best = (rec, sim)

    if best is None:
        return {"checked_against": len(others), "max_similarity": None}, [], 100.0

    rec, sim = best
    flags = []
    if sim >= EMBEDDING_TEMPLATE_THRESHOLD:
        flags.append(f"Near-duplicate resume text (cosine similarity {sim:.2f}) also on file under the name '{rec.full_name or 'unknown'}' — likely a templated/mass-produced application.")
        score = max(0.0, 100.0 - (sim - EMBEDDING_TEMPLATE_THRESHOLD) * 500)
        matched_name = rec.full_name
    else:
        score = 100.0
        matched_name = None

    return {"checked_against": len(others), "max_similarity": round(sim, 3), "matched_name": matched_name}, flags, score


def _upsert_resume_embedding(db, scan_id: str, embedding: list[float] | None, text_len: int) -> None:
    """Partial update, not merge() — merge() would overwrite the identity
    fields fraud_identity.check_identity already saved on this row with
    None, since it replaces every mapped column on the transient object."""
    if embedding is None:
        return
    existing = db.query(IdentityRecord).filter(IdentityRecord.id == scan_id).first()
    if existing:
        existing.resume_embedding = embedding
        existing.resume_text_len = text_len
    else:
        db.add(IdentityRecord(id=scan_id, resume_embedding=embedding, resume_text_len=text_len))
    db.commit()


# ─────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────


def check_resume_authenticity(
    scan_id: str, text: str, file_path: str, content_type: str, extracted_identity: "fraud_llm.ExtractedIdentity | None"
) -> dict:
    if not text or len(text.strip()) < MIN_TEXT_CHARS:
        return {
            "key": "resume_authenticity", "title": "Resume Authenticity Check", "status": "na", "score": None,
            "summary": "Not enough extracted text to assess resume authenticity.", "details": {},
        }

    extracted = extracted_identity or fraud_llm.ExtractedIdentity()

    logic_checks = _resume_logic_checks(extracted)
    logic_score = 100.0 if not logic_checks else 100.0 * sum(c["passed"] for c in logic_checks) / len(logic_checks)

    domain_checks, domain_flags = _check_domain_crossref(extracted.employers, extracted.email)
    domain_score = 100.0 if not domain_checks else 100.0 * sum(c["passed"] for c in domain_checks) / len(domain_checks)

    try:
        metadata_step = fraud_metadata.check_metadata(file_path, content_type)
        metadata_score = metadata_step["score"] if metadata_step.get("score") is not None else 85.0
        metadata_summary = metadata_step.get("summary", "")
    except Exception as e:
        metadata_score, metadata_summary = 85.0, f"Metadata check unavailable: {e}"

    embedding = _resume_embedding(text)
    db = SessionLocal()
    try:
        embedding_details, embedding_flags, embedding_score = _check_embedding_similarity(db, scan_id, extracted.candidate_name, embedding)
        _upsert_resume_embedding(db, scan_id, embedding, len(text))
    except Exception as e:
        db.rollback()
        embedding_details, embedding_flags, embedding_score = {"error": str(e)}, [], 85.0
    finally:
        db.close()

    try:
        ai_signal = fraud_llm.classify_ai_text(text, langfuse_trace_id=trace_id_for(scan_id))
    except Exception as e:
        ai_signal = fraud_llm.AiTextSignal(ai_generated_likelihood=50, reasons=[f"AI-text classifier unavailable: {e}"])
    ai_text_score = 100.0 - ai_signal.ai_generated_likelihood

    overall = (
        LOGIC_WEIGHT * logic_score + DOMAIN_WEIGHT * domain_score + METADATA_WEIGHT * metadata_score
        + EMBEDDING_WEIGHT * embedding_score + AI_TEXT_WEIGHT * ai_text_score
    )
    non_ai_weight = LOGIC_WEIGHT + DOMAIN_WEIGHT + METADATA_WEIGHT + EMBEDDING_WEIGHT
    non_ai_score = (
        LOGIC_WEIGHT * logic_score + DOMAIN_WEIGHT * domain_score + METADATA_WEIGHT * metadata_score + EMBEDDING_WEIGHT * embedding_score
    ) / non_ai_weight

    overall_rounded = round(overall)
    status = "pass" if overall_rounded >= 75 else "warn" if overall_rounded >= 50 else "fail"
    if status == "fail" and non_ai_score >= 75:
        # The AI-text classifier is the least-trusted signal in this ensemble
        # (see fraud_llm.py) — on its own it can soften a verdict to "warn",
        # never drive a "fail" for a resume that's otherwise clean.
        status = "warn"

    flags = [c["detail"] for c in logic_checks if not c["passed"]] + domain_flags + embedding_flags
    if ai_signal.ai_generated_likelihood >= 70:
        flags.append(f"Possible AI-generated text (ensemble signal only, not conclusive): {ai_signal.reasons[0] if ai_signal.reasons else 'generic, template-like phrasing.'}")

    summary = (
        "No authenticity concerns across logic, employer-domain, metadata, or duplication checks."
        if not flags else f"{len(flags)} concern(s) found: {flags[0]}"
    )

    return {
        "key": "resume_authenticity",
        "title": "Resume Authenticity Check",
        "status": status,
        "score": overall_rounded,
        "summary": summary,
        "details": {
            "sub_scores": {
                "logic_checks": round(logic_score),
                "employer_domain_crossref": round(domain_score),
                "file_metadata": round(metadata_score),
                "embedding_similarity": round(embedding_score),
                "ai_text_signal": round(ai_text_score),
            },
            "weights": {
                "logic_checks": LOGIC_WEIGHT, "employer_domain_crossref": DOMAIN_WEIGHT, "file_metadata": METADATA_WEIGHT,
                "embedding_similarity": EMBEDDING_WEIGHT, "ai_text_signal": AI_TEXT_WEIGHT,
            },
            "logic_checks": logic_checks,
            "domain_checks": domain_checks,
            "metadata_summary": metadata_summary,
            "embedding": embedding_details,
            "ai_text_signal": {"ai_generated_likelihood": ai_signal.ai_generated_likelihood, "reasons": ai_signal.reasons},
            "flags": flags,
        },
    }
