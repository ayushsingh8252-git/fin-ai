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
import logging
import re
from typing import Any, Dict, List, Optional

from ..mcp.base import BaseMCPConnector, MCPToolError
from ..config import settings
from ..services.resilience import CircuitOpenError
from ..services.web_service import tavily_search

logger = logging.getLogger(__name__)

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

_LEGITIMACY_NEGATIVE_SIGNALS = ("is a scam", "scam company", "fraudulent company", "fake company", "not legit", "ponzi scheme", "blacklisted by", "fake employer", "fake experience")
_LEGITIMACY_POSITIVE_SIGNALS = ("official website", "linkedin.com/company", "crunchbase.com", "wikipedia.org", "glassdoor.com", "registered in", "headquartered in", "founded in", "pvt ltd", "private limited", "corporation", "inc.", "payment gateway", "technology company")


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

        # Each of these three already gets real retries + a circuit breaker
        # inside tavily_search() (services/web_service.py -> resilience.py),
        # so by the time an exception reaches this layer, retrying again
        # here wouldn't help — the honest move is to report exactly which
        # lookup couldn't complete rather than inventing data for it. Each is
        # tried independently so one lookup failing (e.g. Tavily's breaker
        # trips mid-request) doesn't discard the other two if they succeeded.
        # Failures surface in `warnings` rather than inline on hr_contacts
        # (a list) — an empty list there already legitimately means "no
        # LinkedIn profiles found", so a failure needs its own signal to stay
        # distinguishable from that normal zero-results case.
        import concurrent.futures

        # In-memory cache to make repeated runs instant
        cache_key = f"{company_name.lower()}::{location.lower()}"
        if not hasattr(self, "_cache"):
            self._cache = {}
        cached = self._cache.get(cache_key)
        if cached:
            return cached

        warnings: List[str] = []

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            fut_legit = executor.submit(
                self._safe_lookup, "legitimacy", self._check_legitimacy, company_name, location, warnings, {
                    "verdict": "unknown", "score": 0, "positive_signals": 0, "negative_signals": 0, "evidence": [],
                }
            )
            fut_hr = executor.submit(
                self._safe_lookup, "hr_contacts", self._find_hr_linkedin, company_name, location, warnings, []
            )
            fut_phone = executor.submit(
                self._safe_lookup, "hr_contact_number", self._find_company_contact_number, company_name, location, warnings, {
                    "number": None, "source_url": None, "source_title": None,
                }
            )

            legitimacy = fut_legit.result()
            hr_contacts = fut_hr.result()
            hr_contact_number = fut_phone.result()

        result = {
            "company": company_name,
            "location": location,
            "legitimacy": legitimacy,
            "hr_contacts": hr_contacts,
            "hr_contact_number": hr_contact_number,
            "warnings": warnings or None,
        }
        self._cache[cache_key] = result
        return result

    def _safe_lookup(self, label: str, fn, company_name: str, location: str, warnings: List[str], default: Any) -> Any:
        try:
            return fn(company_name, location)
        except CircuitOpenError as e:
            logger.warning("[verification_tools] %s lookup for %r: search circuit open (%s)", label, company_name, e)
            warnings.append(f"{label}: web search temporarily unavailable after repeated failures — try again shortly.")
            return default
        except Exception as e:
            logger.error("[verification_tools] %s lookup for %r failed after retries: %s", label, company_name, e)
            warnings.append(f"{label}: web search failed — {e}")
            return default

    # ---- 1. legitimacy ----------------------------------------------------

    def _check_legitimacy(self, company_name: str, location: Optional[str]) -> Dict[str, Any]:
        import concurrent.futures
        loc_suffix = f" {location}" if location else ""
        queries = [
            f'"{company_name}" official website OR "about us"{loc_suffix}',
            f'"{company_name}" linkedin company OR crunchbase{loc_suffix}',
            f'"{company_name}" ("fake company" OR "fraudulent company" OR "scam company" OR "fake experience")',
        ]

        evidence: List[Dict[str, str]] = []
        seen_urls = set()
        positive_hits = 0
        negative_hits = 0

        with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as pool:
            query_results = list(pool.map(lambda q: tavily_search(q, max_results=6), queries))

        for search_hits in query_results:
            for r in search_hits:
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
        import concurrent.futures
        loc_suffix = f' "{location}"' if location else ""
        queries = [
            f'site:linkedin.com/in "{company_name}" ("HR" OR "Human Resources" OR "Talent Acquisition"){loc_suffix}',
            f'site:linkedin.com/in "{company_name}" (recruiter OR "HR Manager" OR "Head of HR" OR "CHRO"){loc_suffix}',
            f'site:linkedin.com/in "{company_name}" ("People Operations" OR "HRBP" OR "VP HR"){loc_suffix}',
        ]

        candidates: Dict[str, Dict[str, Any]] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as pool:
            query_results = list(pool.map(lambda q: tavily_search(q, max_results=8), queries))

        for search_hits in query_results:
            for r in search_hits:
                url = r.get("url", "")
                if "linkedin.com/in/" not in url.lower():
                    continue  # only accept actual LinkedIn profile URLs, per spec
                if url in candidates:
                    continue

                title_text = r.get("title", "") or ""
                content_text = r.get("content", "") or ""
                name, title = _parse_name_and_title(title_text)
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
        import concurrent.futures
        loc_suffix = f" {location}" if location else ""
        queries = [
            f'"{company_name}" (HR OR official) (contact OR phone) number{loc_suffix}',
            f'"{company_name}" head office phone number{loc_suffix}',
        ]

        with concurrent.futures.ThreadPoolExecutor(max_workers=len(queries)) as pool:
            query_results = list(pool.map(lambda q: tavily_search(q, max_results=5), queries))

        for search_hits in query_results:
            for r in search_hits:
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
