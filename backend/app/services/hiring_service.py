"""
Agentic Hiring Pipeline — resume parsing, ATS scoring, requirement matching,
and assignment generation.

Reuses the existing PDF text extraction (parsing.parse_pdf) and the
Groq-primary/Gemini-fallback JSON generation already used for policy Q&A,
fraud reasoning, and interview scoring (see llm_service.generate_json), so
this gets the same dual-provider resilience instead of a separate bespoke
LLM integration. Every LLM call has a deterministic, non-LLM fallback so a
provider outage degrades the pipeline instead of breaking it.
"""
import re
from typing import Any, Dict, List, Optional

from .llm_service import generate_json_resilient as generate_json
from .parsing import parse_pdf

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
# Matches an optional leading country code plus 2-5 grouped digit runs
# (covering formats like "+91 98765 43210", "(415) 555-2671", "555-123-4567").
# This alone is still loose enough to match a date range or a zip code, so
# every caller MUST additionally check PHONE_DIGIT_RANGE via
# _looks_like_phone() below before trusting a match as a real phone number.
PHONE_RE = re.compile(
    r"(?<!\d)(?:\+\d{1,3}[\s.-]?)?\(?\d{2,5}\)?(?:[\s.-]?\d{2,5}){1,4}(?!\d)"
)
# A real phone number, once separators are stripped, has this many digits —
# short of it and it's more likely a zip/pin code, longer and it's more
# likely a date range or an unrelated id number that happened to match.
PHONE_DIGIT_RANGE = (10, 13)


def _looks_like_phone(candidate: Optional[str]) -> bool:
    if not candidate:
        return False
    digits = re.sub(r"\D", "", candidate)
    return PHONE_DIGIT_RANGE[0] <= len(digits) <= PHONE_DIGIT_RANGE[1]

# Resume text is truncated before being sent to the LLM for scoring; keep
# this equal to RESUME_TEXT_STORE_CHARS below so scoring always sees at
# least as much of the resume as we persist for later use.
RESUME_TEXT_PROMPT_CHARS = 8000
RESUME_TEXT_STORE_CHARS = 8000

# Recommendation tiers shared by every code path (LLM-scored and fallback)
# so "Not a Fit" is always reachable and thresholds never silently diverge.
_STRONG_HIRE_MIN = 85
_HIRE_MIN = 65
_CONSIDER_MIN = 40

# Generic English words that show up in requirement briefs but aren't
# themselves skills — filtered out when heuristically tokenizing a
# requirement brief for the no-LLM fallback matcher.
_REQUIREMENT_STOPWORDS = {
    "a", "an", "and", "or", "the", "with", "for", "of", "to", "in", "on", "is",
    "are", "be", "we", "you", "our", "this", "that", "as", "at", "by", "from",
    "will", "who", "role", "roles", "job", "years", "year", "experience",
    "strong", "good", "excellent", "solid", "knowledge", "skills", "skill",
    "required", "must", "have", "having", "working", "proficiency",
    "proficient", "understanding", "ability", "candidate", "candidates",
    "looking", "should", "preferred", "plus", "etc", "using", "use",
    "develop", "developing", "development", "build", "building", "team",
    "work", "also", "including", "include", "responsibilities",
    "requirements", "nice", "have", "familiarity", "familiar", "hands",
    "need", "needs", "needed", "someone", "person", "people", "background",
    "environment", "level", "based", "across", "into", "can", "well",
    "backend", "frontend", "fullstack", "engineer", "engineering",
    "developer", "development", "senior", "junior", "mid", "position",
    "opportunity", "company", "great", "highly", "motivated", "passionate",
}


def _recommendation_from_score(score: int) -> str:
    """Single shared threshold table for every recommendation string in this file."""
    if score >= _STRONG_HIRE_MIN:
        return "Strong Hire"
    if score >= _HIRE_MIN:
        return "Hire"
    if score >= _CONSIDER_MIN:
        return "Consider"
    return "Not a Fit"

RESUME_SYSTEM_INSTRUCTION = """You are a resume parsing and ATS scoring engine. Given the raw extracted
text of a resume PDF, extract structured fields and score the resume's overall quality/completeness
the way an Applicant Tracking System would — independent of any specific job requirement.

Return ONLY a JSON object with this exact shape:
{"name": "<candidate full name, or null if not found>",
 "email": "<candidate email, or null if not found>",
 "phone": "<candidate phone number, or null if not found>",
 "experience": "<short experience summary, e.g. '4 Years'>",
 "skills": ["<skill1>", "<skill2>", ...up to 8 most relevant skills],
 "summary": "<1-2 sentence honest summary of the candidate's background>",
 "ats_score": <integer 0-100, resume structure/clarity/completeness quality>}"""

MATCH_SYSTEM_INSTRUCTION = """You are a requirement-matching engine for a hiring pipeline. Given a
candidate's parsed skills/experience and a role requirement brief, score how well the candidate fits.

Return ONLY a JSON object with this exact shape:
{"match_score": <integer 0-100>,
 "matched_skills": ["<skill the candidate has that the role needs>", ...],
 "missing_skills": ["<skill the role needs that the candidate lacks>", ...],
 "recommendation": "<one of: 'Strong Hire', 'Hire', 'Consider', 'Not a Fit'>"}"""

ASSIGNMENT_SYSTEM_INSTRUCTION = """You are an assignment-generation engine for a hiring pipeline. Given
an HR-written requirement brief for a take-home assignment, draft a short, concrete assignment.

Return ONLY a JSON object with this exact shape:
{"title": "<short assignment title, e.g. 'Backend Engineer Assessment'>",
 "duration": "<expected completion time, e.g. '48 Hours'>",
 "requirements": ["<requirement 1>", "<requirement 2>", ...3-6 items],
 "submission": "<how it should be submitted, e.g. 'GitHub Repository'>"}"""


def _extract_email_phone(text: str) -> tuple[Optional[str], Optional[str]]:
    email_match = EMAIL_RE.search(text)
    phone_match = PHONE_RE.search(text)
    email = email_match.group(0) if email_match else None
    candidate_phone = phone_match.group(0).strip() if phone_match else None
    # Only surface the regex hit if it actually looks phone-shaped (right
    # digit count) — otherwise it's likely a date range or id number that
    # happened to match the loose grouping pattern above.
    phone = candidate_phone if _looks_like_phone(candidate_phone) else None
    return email, phone


def _fallback_resume_fields(filename: str, text: str) -> Dict[str, Any]:
    email, phone = _extract_email_phone(text)
    first_line = next((l.strip() for l in text.splitlines() if l.strip()), filename)
    year_match = re.search(r"(\d+)\+?\s*years?", text, re.IGNORECASE)
    return {
        "name": first_line[:60] or filename,
        "email": email,
        "phone": phone,
        "experience": f"{year_match.group(1)} Years" if year_match else "Not specified",
        "skills": [],
        "summary": "Automated summary unavailable — both LLM providers failed. Review the resume manually.",
        "ats_score": 60,
        # The 60 above is a placeholder, not a measurement. Callers that
        # persist scores (services/recruitment_service.py) read this flag and
        # record the score as not_computed instead of storing the placeholder.
        # Existing callers ignore the extra key.
        "degraded": True,
    }


def extract_resume_fields(filename: str, text: str) -> Dict[str, Any]:
    """Parses raw resume text into structured fields + an ATS quality score."""
    if not text.strip():
        return {**_fallback_resume_fields(filename, text), "summary": "No extractable text found in this PDF."}

    prompt = f"Resume filename: {filename}\n\nRaw extracted resume text:\n{text[:RESUME_TEXT_PROMPT_CHARS]}"
    fallback_used = False
    try:
        result = generate_json(prompt, RESUME_SYSTEM_INSTRUCTION)
        if not isinstance(result, dict):
            raise ValueError("Resume extraction response was not a JSON object")
    except Exception as e:
        print(f"[Hiring Resume Extraction Error] {e}")
        result = _fallback_resume_fields(filename, text)
        fallback_used = True
    # Set from what actually happened, never trusted from the model output.
    result["degraded"] = fallback_used

    # Regex-extracted contact info is more reliable than LLM output for exact
    # strings — prefer it when present, fall back to whatever the LLM found.
    # _extract_email_phone() already discards regex phone matches that don't
    # look phone-shaped (see _looks_like_phone), so a non-None regex_phone
    # here is safe to prefer over the LLM's answer; otherwise keep the LLM's
    # contextual answer instead of a false-positive date/id match.
    regex_email, regex_phone = _extract_email_phone(text)
    result["email"] = regex_email or result.get("email")
    result["phone"] = regex_phone or result.get("phone")
    result.setdefault("name", filename)
    if not result.get("name"):
        result["name"] = filename
    result.setdefault("skills", [])
    if not isinstance(result.get("skills"), list):
        result["skills"] = []
    result.setdefault("experience", "Not specified")
    result.setdefault("summary", "")
    try:
        result["ats_score"] = max(0, min(100, int(result["ats_score"])))
    except (KeyError, TypeError, ValueError):
        # The model answered but gave no usable score. 60 stays for the legacy
        # endpoint's sake; the flag lets score-persisting callers know it is
        # a default rather than a measurement.
        result["ats_score"] = 60
        result["ats_score_defaulted"] = True

    return result


def parse_resume_pdf(filename: str, file_path: str) -> Dict[str, Any]:
    """Extracts text from an uploaded resume PDF and returns structured fields."""
    try:
        blocks = parse_pdf(file_path)
        text = "\n".join(b["text"] for b in blocks)
    except Exception as e:
        print(f"[Hiring Resume Parse Error] {e}")
        text = ""
    fields = extract_resume_fields(filename, text)
    fields["filename"] = filename
    fields["resume_text"] = text[:RESUME_TEXT_STORE_CHARS]
    return fields


def _skill_matches_text(skill: str, text_lower: str) -> bool:
    """Word-boundary-aware containment check so short skill names (e.g. 'R',
    'Go') don't false-match inside unrelated words ('Good', 'Angular')."""
    skill_lower = skill.lower().strip()
    if not skill_lower:
        return False
    return re.search(rf"\b{re.escape(skill_lower)}\b", text_lower) is not None


def _tokenize_requirement(requirement: str) -> List[str]:
    """Best-effort extraction of skill-like tokens from a free-text
    requirement brief (there's no structured 'required skills' list to
    read from), filtering out common non-skill English words."""
    words = re.findall(r"[A-Za-z][A-Za-z0-9+.#/-]*", requirement)
    tokens: List[str] = []
    seen = set()
    for w in words:
        token = w.lower().strip(".-/")
        if len(token) < 2 or token in _REQUIREMENT_STOPWORDS or token in seen:
            continue
        seen.add(token)
        tokens.append(token)
    return tokens


def _fallback_match(candidate: Dict[str, Any], requirement: str) -> Dict[str, Any]:
    req_lower = requirement.lower()
    skills = candidate.get("skills") or []

    matched = [s for s in skills if _skill_matches_text(s, req_lower)]
    matched_lower = {m.lower().strip() for m in matched}

    # missing_skills = tokens the requirement appears to ask for that the
    # candidate's own skill list doesn't cover — not the candidate's skills
    # themselves (that told us nothing about a gap).
    candidate_skills_lower = [s.lower().strip() for s in skills]
    missing = [
        token for token in _tokenize_requirement(requirement)
        if token not in matched_lower
        and not any(_skill_matches_text(token, cs) for cs in candidate_skills_lower)
    ][:10]

    total_considered = len(matched) + len(missing)
    if total_considered > 0:
        score = round(100 * len(matched) / total_considered)
    else:
        # No requirement text (or nothing tokenizable) to compare against —
        # fall back to the resume's own quality score as a last resort.
        score = candidate.get("ats_score", 60)
    score = max(0, min(100, score))

    return {
        "match_score": score,
        "matched_skills": matched,
        "missing_skills": missing,
        "recommendation": _recommendation_from_score(score),
        # Keyword overlap, not a model judgement: real arithmetic over real
        # data, but not the AI result the UI would imply. Flagged so callers
        # can label it instead of presenting it as an LLM score.
        "degraded": True,
    }


def match_candidate_to_requirement(candidate: Dict[str, Any], requirement: str, role_title: str = "the open role") -> Dict[str, Any]:
    """Scores how well a parsed candidate fits an HR-written requirement brief."""
    if not requirement.strip():
        return _fallback_match(candidate, requirement)

    # Candidate name is deliberately left out of the prompt — it carries no
    # legitimate signal for skill/experience fit and only exposes the model
    # to unnecessary demographic bias risk. Attach it to the result below,
    # after scoring, if callers need it.
    prompt = (
        f"Role: {role_title}\n\n"
        f"Requirement brief:\n{requirement.strip()}\n\n"
        f"Experience: {candidate.get('experience')}\n"
        f"Skills: {', '.join(candidate.get('skills') or [])}\n"
        f"Summary: {candidate.get('summary')}"
    )
    fallback_used = False
    try:
        result = generate_json(prompt, MATCH_SYSTEM_INSTRUCTION)
        if not isinstance(result, dict):
            raise ValueError("Match response was not a JSON object")
    except Exception as e:
        print(f"[Hiring Requirement Match Error] {e}")
        result = _fallback_match(candidate, requirement)
        fallback_used = True
    result["degraded"] = fallback_used

    try:
        result["match_score"] = max(0, min(100, int(result["match_score"])))
    except (KeyError, TypeError, ValueError):
        result["match_score"] = 60
        result["match_score_defaulted"] = True
    result.setdefault("matched_skills", [])
    result.setdefault("missing_skills", [])
    result.setdefault("recommendation", _recommendation_from_score(result["match_score"]))
    result["candidate_name"] = candidate.get("name")
    return result


# ─────────────────────────────────────────────────────────────────────────
# Actionable resume summary — deliberately zero-LLM.
#
# Every input here (ats_score, skills, experience, email/phone) was already
# extracted by extract_resume_fields()'s single LLM call during parsing —
# this function only re-derives human-readable bullet points from data that
# already exists in memory. It makes no network call and costs no LLM
# tokens, so it's safe to call on every candidate, every time a recruiter
# opens a profile, with no added latency or spend. The optional
# `requirement` skill-gap comparison reuses _tokenize_requirement /
# _skill_matches_text — the same deterministic matcher _fallback_match()
# already uses — rather than a second LLM call.
# ─────────────────────────────────────────────────────────────────────────


def generate_actionable_summary(candidate: Dict[str, Any], requirement: Optional[str] = None) -> Dict[str, Any]:
    """Turns an already-parsed candidate (from extract_resume_fields /
    parse_resume_pdf) into a short headline + concrete, recruiter-actionable
    bullet points. Pure post-processing of existing fields — no LLM call."""
    points: List[str] = []

    ats_score = candidate.get("ats_score")
    try:
        ats_score = int(ats_score)
    except (TypeError, ValueError):
        ats_score = None
    if ats_score is not None:
        if ats_score >= 85:
            points.append(f"Resume is well-structured and ATS-friendly ({ats_score}/100).")
        elif ats_score >= 60:
            points.append(f"Resume structure is usable but could be tightened for ATS parsing ({ats_score}/100).")
        else:
            points.append(f"Resume formatting/completeness is weak ({ats_score}/100) — may get filtered by automated ATS screens.")

    if not candidate.get("email"):
        points.append("No email address found on the resume — verify contact details before outreach.")
    if not candidate.get("phone"):
        points.append("No phone number found on the resume — verify contact details before outreach.")

    experience = candidate.get("experience")
    if not experience or experience == "Not specified":
        points.append("Experience duration wasn't clearly stated — confirm with the candidate directly.")

    skills = candidate.get("skills") or []
    if not isinstance(skills, list):
        skills = []
    if not skills:
        points.append("No skills were extracted — resume may lack a clear skills section.")
    elif len(skills) < 3:
        points.append(f"Only {len(skills)} skill(s) detected — resume may be light on keyword coverage.")

    requirement_gap: Optional[Dict[str, Any]] = None
    if requirement and requirement.strip():
        match = _fallback_match(candidate, requirement)
        requirement_gap = match
        matched = match["matched_skills"]
        missing = match["missing_skills"]
        total = len(matched) + len(missing)
        if total > 0:
            points.append(
                f"Matches {len(matched)}/{total} requirement keywords"
                + (f": {', '.join(matched[:6])}" if matched else "") + "."
            )
        if missing:
            points.append(f"Missing likely-required keywords: {', '.join(missing[:6])}.")
        points.append(f"Deterministic fit against this requirement: {match['recommendation']} ({match['match_score']}/100).")

    return {
        "candidate_name": candidate.get("name"),
        "headline_summary": candidate.get("summary") or "",
        "actionable_points": points,
        "requirement_gap": requirement_gap,
        "generated_from": "deterministic-no-llm",
    }


def _fallback_assignment(requirement: str) -> Dict[str, Any]:
    lower = requirement.lower()
    bullet_lines = [
        re.sub(r"^[•\-*]\s*|^\d+[.)]\s*", "", l.strip())
        for l in requirement.split("\n")
        if re.match(r"^[•\-*]|^\d+[.)]", l.strip())
    ]
    title = "Technical Assessment"
    if "full stack" in lower or "full-stack" in lower:
        title = "Full-Stack Engineer Assessment"
    elif "backend" in lower or "back-end" in lower or "api" in lower:
        title = "Backend Engineer Assessment"
    elif "frontend" in lower or "front-end" in lower or "react" in lower:
        title = "Frontend Engineer Assessment"
    elif "machine learning" in lower or " ml " in lower or " ai " in lower:
        title = "AI/ML Engineer Assessment"

    hour_match = re.search(r"(\d+)\s*hour", lower)
    day_match = re.search(r"(\d+)\s*day", lower)
    duration = f"{hour_match.group(1)} Hours" if hour_match else f"{day_match.group(1)} Days" if day_match else "48 Hours"

    return {
        "title": title,
        "duration": duration,
        "requirements": bullet_lines[:6] or ["FastAPI", "Authentication", "Docker", "Unit Tests"],
        "submission": "GitHub Repository",
    }


def generate_assignment(requirement: str, role_title: str = "the open role") -> Dict[str, Any]:
    """Drafts a take-home assignment brief from an HR-written requirement."""
    if not requirement.strip():
        return _fallback_assignment(requirement)

    prompt = f"Role: {role_title}\n\nHR requirement brief:\n{requirement.strip()}"
    try:
        result = generate_json(prompt, ASSIGNMENT_SYSTEM_INSTRUCTION)
        if not isinstance(result, dict) or not result.get("title"):
            raise ValueError("Assignment response was not a valid JSON object")
    except Exception as e:
        print(f"[Hiring Assignment Generation Error] {e}")
        result = _fallback_assignment(requirement)

    result.setdefault("duration", "48 Hours")
    result.setdefault("submission", "GitHub Repository")
    if not isinstance(result.get("requirements"), list) or not result["requirements"]:
        result["requirements"] = _fallback_assignment(requirement)["requirements"]
    return result
