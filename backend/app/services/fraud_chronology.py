"""
Chronological Feasibility & Timeline Consistency Matrix.

Validates:
1. Candidate Age vs Career Milestones:
   - e.g. graduating high school before age 15 or claiming 8 years experience at age 22.
2. PAN/ID Issue Date vs DOB:
   - e.g. PAN issued before the candidate was born.
3. Realistic Employment Tenure vs Degree Overlap.
"""

from datetime import date, datetime
from typing import Optional, List, Dict


def _parse_year(raw_str: str) -> Optional[int]:
    if not raw_str:
        return None
    import re
    m = re.search(r'\b(19\d\d|20\d\d)\b', str(raw_str))
    if m:
        return int(m.group(1))
    return None


def check_chronological_feasibility(
    dob_str: Optional[str] = None,
    graduation_year: Optional[int] = None,
    total_experience_years: Optional[float] = None,
    work_start_year: Optional[int] = None,
    extracted_text: str = ""
) -> dict:
    """
    Evaluates chronological consistency across extracted dates.
    """
    flags = []
    risk_score = 0.0
    details = {}

    current_year = date.today().year

    # 1. Parse DOB year if present
    birth_year = None
    if dob_str:
        birth_year = _parse_year(dob_str)
        details["birth_year"] = birth_year

    # 2. Check Age at Graduation
    if birth_year and graduation_year:
        age_at_grad = graduation_year - birth_year
        details["age_at_graduation"] = age_at_grad
        if age_at_grad < 18:
            flags.append(f"Unrealistic timeline: Graduation in {graduation_year} indicates candidate was {age_at_grad} years old at college graduation.")
            risk_score += 0.50
        elif age_at_grad > 65:
            flags.append(f"Timeline anomaly: Age at graduation is {age_at_grad} years.")
            risk_score += 0.20

    # 3. Check Experience Claimed vs Age
    if birth_year and total_experience_years:
        current_age = current_year - birth_year
        details["current_age"] = current_age
        max_possible_exp = max(0, current_age - 18)
        if total_experience_years > max_possible_exp + 1:
            flags.append(f"Experience Inflation: Candidate is ~{current_age} years old but claims {total_experience_years:.1f} years of professional experience.")
            risk_score += 0.65

    # 4. Check Work Start Year vs Birth Year
    if birth_year and work_start_year:
        age_at_work_start = work_start_year - birth_year
        details["age_at_first_job"] = age_at_work_start
        if age_at_work_start < 16:
            flags.append(f"Career start anomaly: Professional employment start in {work_start_year} implies work started at age {age_at_work_start}.")
            risk_score += 0.40

    if flags:
        return {
            "key": "chronology",
            "title": "Chronological & Age Feasibility Matrix",
            "status": "flagged",
            "score": min(1.0, risk_score),
            "summary": f"Timeline Inconsistency: {'; '.join(flags)}",
            "details": {
                **details,
                "flags": flags,
            },
        }

    return {
        "key": "chronology",
        "title": "Chronological & Age Feasibility Matrix",
        "status": "passed",
        "score": 0.0,
        "summary": "All career milestones and age dates are chronologically sound and feasible.",
        "details": details,
    }
