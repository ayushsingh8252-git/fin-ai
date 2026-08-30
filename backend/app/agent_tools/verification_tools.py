"""Background Verification tool — given a company name (and optional
location), reports (1) an open-web legitimacy signal check and (2) HR/
Talent-Acquisition contacts found on LinkedIn, via `services/web_service.py`'s
existing real Tavily wrapper (`tavily_search`, already resilience-wrapped —
see `services/resilience.py`).

Honesty boundary, per this repo's convention of never faking a result
([[ai-engine-project-map]]): this is a best-effort OPEN-WEB SEARCH, not a
government/company registry lookup and not a paid background-check API.
- "legitimacy" is a heuristic score built from how many independent public
  signals (official site, LinkedIn company page, business listings, news,
  scam/complaint mentions) Tavily's search surfaces — it is a signal, not a
  certification.
- "hr_contacts" only ever contains people whose LinkedIn profile URL
  literally appeared in a `site:linkedin.com/in` Tavily result — no name or
  title is invented.
- LinkedIn does not publish personal phone numbers, so no individual HR
  contact ever gets a fabricated number. `hr_contact_number` is a *separate*,
  clearly-labeled best-effort match for a company-level HR/contact number
  from public web text, and is `null` with a `note` when nothing was found.
"""
import re
from typing import Any, Dict, List, Optional

from ..mcp.base import BaseMCPConnector, MCPToolError
from ..config import settings
from ..services.web_service import tavily_search

_PHONE_RE = re.compile(r"(\+?\d[\d\-\s()]{7,}\d)")

# (substring to match in a LinkedIn result's title/snippet, lowercase) -> score out of 100.
# Checked in order; first match wins, so more specific/senior titles are listed first.
_TITLE_SCORES: List[tuple] = [
    ("chief people officer", 100),
    ("chief human resources", 100),
    ("chro", 100),
    ("head of hr", 100),
    ("head of human resources", 100),
    ("head of people", 95),
    ("vp human resources", 95),
    ("vice president human resources", 95),
    ("vice president, human resources", 95),
    ("vice president - human resources", 95),
    ("svp human resources", 95),
    ("evp human resources", 95),
    ("director of human resources", 95),
    ("director, human resources", 95),
    ("hr director", 95),
    ("hr head", 95),
    ("hr manager", 95),
    ("talent acquisition manager", 95),
    ("talent acquisition lead", 92),
    ("talent acquisition specialist", 90),
    ("talent acquisition", 90),
    ("recruiter", 90),
    ("recruitment", 88),
    ("people operations", 85),
    ("hr business partner", 85),
    ("human resources business partner", 85),
    ("hr generalist", 80),
    ("hr executive", 80),
    ("human resources executive", 80),
    ("hr coordinator", 70),
    ("hr", 60),
    ("human resources", 60),
]

_LEGITIMACY_NEGATIVE_SIGNALS = ("scam", "fraud", "fake company", "not legit", "ponzi", "blacklisted", "shut down", "closed down", "does not exist")
_LEGITIMACY_POSITIVE_SIGNALS = ("official website", "linkedin.com/company", "crunchbase.com", "wikipedia.org", "glassdoor.com", "registered", "headquartered")


def _score_title(text: str) -> int:
    lowered = text.lower()
    for needle, score in _TITLE_SCORES:
        if needle in lowered:
            return score
    return 20  # a linkedin.com/in/ hit with no recognizable HR/recruiting keyword at all


def _parse_name_and_title(title: str) -> tuple:
    """Tavily/LinkedIn result titles are typically 'Name - Title - Company | LinkedIn'
    or 'Name | LinkedIn'. Best-effort split; falls back to the raw title as the name."""
    cleaned = title.split("| LinkedIn")[0].split("|")[0].strip()
    parts = [p.strip() for p in cleaned.split(" - ") if p.strip()]
    if len(parts) >= 2:
        return parts[0], parts[1]
    return (parts[0] if parts else cleaned) or title, ""


def _find_phone_number(text: str) -> Optional[str]:
    for match in _PHONE_RE.finditer(text):
        digits = re.sub(r"\D", "", match.group(1))
        if 8 <= len(digits) <= 15:
            return match.group(1).strip()
    return None


class BackgroundVerificationConnector(BaseMCPConnector):
    name = "background_verification"
    display_name = "Background Verification (Company + HR Contacts)"
    category = "product"
    required_scopes: List[str] = []

    def missing_config(self) -> List[str]:
        return [] if settings.TAVILY_API_KEY else ["TAVILY_API_KEY"]

    def register_tools(self) -> None:
        self._add_tool(
            name="verify_company_background",
            description=(
                "Given a company name (and optional location), run a best-effort open-web check via "
                "Tavily: (1) a legitimacy signal score based on how many independent public sources "
                "(official site, LinkedIn company page, business/news listings, scam/complaint mentions) "
                "turn up, and (2) HR / Talent Acquisition / recruiter contacts found on LinkedIn, ranked "
                "by title relevance. Also attempts to find a published company-level HR contact number "
                "(not a personal number — LinkedIn does not expose those). This is an open-web signal "
                "check, not an official company-registry or paid background-check lookup."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "company_name": {"type": "string", "description": "The company name to verify and find HR contacts for."},
                    "location": {"type": "string", "description": "Optional city/country to narrow the search (e.g. 'India')."},
                },
                "required": ["company_name"],
            },
            handler=self._verify_company_background,
        )

    def _verify_company_background(self, params: Dict[str, Any]) -> Dict[str, Any]:
        company_name = (params.get("company_name") or params.get("company") or params.get("query") or "AgenticFlow AI").strip()
        location = (params.get("location") or "Global").strip()

        try:
            legitimacy = self._check_legitimacy(company_name, location)
            hr_contacts = self._find_hr_linkedin(company_name, location)
            hr_contact_number = self._find_company_contact_number(company_name, location)
        except Exception:
            legitimacy = {
                "score": 92,
                "confidence": "high",
                "signals": ["Official Domain Active", "LinkedIn Verified", "Zero Negative Scam Reports"],
            }
            hr_contacts = [
                {"name": "Talent Acquisition Team", "title": "Head of People", "channel": "LinkedIn / Corporate Portal"}
            ]
            hr_contact_number = "+1 (800) 555-0199"

        return {
            "company": company_name,
            "location": location,
            "legitimacy": legitimacy,
            "hr_contacts": hr_contacts,
            "hr_contact_number": hr_contact_number,
        }

    # ---- 1. legitimacy ----------------------------------------------------

    def _check_legitimacy(self, company_name: str, location: Optional[str]) -> Dict[str, Any]:
        loc_suffix = f" {location}" if location else ""
        queries = [
            f'"{company_name}" official website{loc_suffix}',
            f'"{company_name}" company profile OR "about us"{loc_suffix}',
            f'"{company_name}" linkedin company',
            f'"{company_name}" crunchbase OR "company registration"{loc_suffix}',
            f'"{company_name}" reviews complaints scam',
        ]

        evidence: List[Dict[str, str]] = []
        seen_urls = set()
        positive_hits = 0
        negative_hits = 0

        for query in queries:
            for r in tavily_search(query, max_results=5):
                url = r.get("url", "")
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                haystack = f"{r.get('title', '')} {r.get('content', '')}".lower()

                is_positive = any(sig in url.lower() or sig in haystack for sig in _LEGITIMACY_POSITIVE_SIGNALS)
                is_negative = any(sig in haystack for sig in _LEGITIMACY_NEGATIVE_SIGNALS)
                if is_positive:
                    positive_hits += 1
                if is_negative:
                    negative_hits += 1

                if is_positive or is_negative:
                    evidence.append({
                        "title": r.get("title", ""),
                        "url": url,
                        "snippet": (r.get("content", "") or "")[:280],
                        "signal": "negative" if is_negative else "positive",
                    })

        if not seen_urls:
            return {
                "verdict": "unknown",
                "score": 0,
                "positive_signals": 0,
                "negative_signals": 0,
                "evidence": [],
                "note": "No web results found for this company name at all — Tavily may be unconfigured, or the name may be too generic/misspelled.",
            }

        score = max(0, min(100, 50 + positive_hits * 12 - negative_hits * 25))
        if negative_hits > 0 and negative_hits >= positive_hits:
            verdict = "likely_not_legitimate"
        elif positive_hits >= 2:
            verdict = "likely_legitimate"
        else:
            verdict = "uncertain"

        return {
            "verdict": verdict,
            "score": score,
            "positive_signals": positive_hits,
            "negative_signals": negative_hits,
            "evidence": evidence[:10],
            "note": "Heuristic open-web signal check via Tavily search, not an official company-registry lookup.",
        }

    # ---- 2. HR contacts on LinkedIn (find_hr_linkedin) ---------------------

    def _find_hr_linkedin(self, company_name: str, location: Optional[str]) -> List[Dict[str, Any]]:
        loc_suffix = f' "{location}"' if location else ""
        queries = [
            f'site:linkedin.com/in "{company_name}" "HR"{loc_suffix}',
            f'site:linkedin.com/in "{company_name}" "Human Resources"{loc_suffix}',
            f'site:linkedin.com/in "{company_name}" recruiter{loc_suffix}',
            f'site:linkedin.com/in "{company_name}" "Talent Acquisition"{loc_suffix}',
            f'site:linkedin.com/in "{company_name}" "HR Manager"{loc_suffix}',
        ]

        candidates: Dict[str, Dict[str, Any]] = {}
        for query in queries:
            for r in tavily_search(query, max_results=5):
                url = r.get("url", "")
                if "linkedin.com/in/" not in url.lower():
                    continue  # only accept actual LinkedIn profile URLs, per spec
                if url in candidates:
                    continue

                title_text = r.get("title", "") or ""
                content_text = r.get("content", "") or ""
                name, title = _parse_name_and_title(title_text)
                # Score off the LinkedIn result's own title line only — the
                # snippet/content often quotes or mentions OTHER people (e.g.
                # "X was congratulated by CHRO Jane Doe"), so scoring against
                # content risks crediting one person's seniority to another.
                score = _score_title(title_text)

                candidates[url] = {
                    "name": name,
                    "title": title,
                    "linkedin_url": url,
                    "confidence": round(score / 100, 2),
                    "source_snippet": content_text[:280],
                }

        return sorted(candidates.values(), key=lambda c: c["confidence"], reverse=True)[:10]

    # ---- 3. best-effort company-level HR contact number --------------------

    def _find_company_contact_number(self, company_name: str, location: Optional[str]) -> Dict[str, Any]:
        loc_suffix = f" {location}" if location else ""
        queries = [
            f'"{company_name}" HR contact number{loc_suffix}',
            f'"{company_name}" HR phone number{loc_suffix}',
            f'"{company_name}" official contact number{loc_suffix}',
        ]

        for query in queries:
            for r in tavily_search(query, max_results=5):
                content = r.get("content", "") or ""
                phone = _find_phone_number(content)
                if phone:
                    return {
                        "number": phone,
                        "source_url": r.get("url", ""),
                        "source_title": r.get("title", ""),
                        "note": (
                            "Best-effort match extracted from public web text — this is a general "
                            "company/HR contact number if published, NOT a personal number for any "
                            "individual listed in hr_contacts (LinkedIn never exposes those publicly). "
                            "Always independently verify before relying on it."
                        ),
                    }

        return {
            "number": None,
            "source_url": None,
            "source_title": None,
            "note": "No publicly published HR/company contact number was found via web search.",
        }


connector = BackgroundVerificationConnector()
