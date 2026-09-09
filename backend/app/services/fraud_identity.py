"""
Duplicate Identity Scan — catches the same person applying/onboarding under
subtly different identity details, which exact-match rules miss (a typo'd
phone digit, "Mohammed" vs "Muhammad", a maiden vs married surname, a new
email for a second application).

Pipeline, matching the brief this module implements:
  1. Blocking — cheap keys (phonetic name key, last-7 phone digits, normalized
     email local-part) narrow the comparison set instead of an O(n^2) scan
     against every prior identity record.
  2. Pairwise classification — for each blocked candidate, engineer a
     similarity feature vector (name variants, DOB, device signal, IP,
     bank account) and score it with an ensemble of a Random Forest and a
     lightweight neural net (sklearn MLPClassifier), averaged. Both are
     bootstrapped on synthetically generated same/different-identity pairs
     (see _generate_training_data) since no labeled historical fraud outcome
     data exists yet in this demo — swapping in real labels later is a
     one-line change to what feeds .fit().
  3. Clustering — matches above threshold merge the new record into an
     existing identity cluster (or start a new one) via an incrementally
     maintained union-find over IdentityRecord.cluster_id, which is the
     practical, storage-light way to keep an identity graph's connected
     components without persisting a full edge list across every scan ever
     run. The specific subgraph that drove *this* scan's result (the new
     record plus every match, edge-weighted by match probability) is still
     built explicitly with networkx and returned in the response so the
     "identity graph" is a real, inspectable structure, not just a hidden id.

Safety notes: bank account numbers are never stored beyond their last 4
digits; device/IP signals are stored as SHA-256 hashes, never raw, so exact
re-use can still be detected without persisting the underlying PII.
"""

import hashlib
import random
import re
import threading
import unicodedata
from datetime import date, datetime

import networkx as nx
import numpy as np
from email_validator import validate_email, EmailNotValidError
from rapidfuzz import fuzz
from rapidfuzz.distance import JaroWinkler
from sklearn.ensemble import RandomForestClassifier
from sklearn.neural_network import MLPClassifier
from sqlalchemy import or_

from ..database import SessionLocal
from ..models import IdentityRecord
from . import fraud_llm
from .llmops import trace_id_for

FEATURE_NAMES = [
    "name_jaro_winkler", "name_token_sort", "phone_match", "email_local_similarity",
    "email_domain_match", "dob_match", "bank_last4_match", "device_signal_match", "ip_match",
]

MATCH_THRESHOLD = 0.55
HIGH_CONFIDENCE_THRESHOLD = 0.80
MAX_BLOCKED_CANDIDATES = 200

_BANK_ACCOUNT_PATTERN = re.compile(
    r"(?:a/?c\.?\s*(?:no\.?|number)?|account\s*(?:no\.?|number)?)\s*[:\-]?\s*(\d{8,18})", re.IGNORECASE
)

# ─────────────────────────────────────────────────────────────────────────
# Normalization / blocking-key helpers
# ─────────────────────────────────────────────────────────────────────────


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def _normalize_name(name: str | None) -> str:
    name = _strip_accents((name or "")).lower()
    name = re.sub(r"[^a-z\s]", " ", name)
    return re.sub(r"\s+", " ", name).strip()


def _soundex(word: str) -> str:
    """Standard Soundex — collapses cultural spelling variants of the same
    name ("Mohammed"/"Muhammad"/"Mohammad") onto the same phonetic code."""
    word = re.sub(r"[^A-Za-z]", "", word or "").upper()
    if not word:
        return "0000"
    codes = {}
    for c in "BFPV":
        codes[c] = "1"
    for c in "CGJKQSXZ":
        codes[c] = "2"
    for c in "DT":
        codes[c] = "3"
    codes["L"] = "4"
    for c in "MN":
        codes[c] = "5"
    codes["R"] = "6"

    result = [word[0]]
    prev_code = codes.get(word[0], "")
    for ch in word[1:]:
        if ch in "HW":
            continue
        code = codes.get(ch, "")
        if code and code != prev_code:
            result.append(code)
        prev_code = code
    return ("".join(result) + "000")[:4]


def _name_block_key(name: str | None) -> str | None:
    """Order-invariant so 'John Smith' and 'Smith John' block together."""
    tokens = _normalize_name(name).split()
    if not tokens:
        return None
    return "-".join(sorted(_soundex(t) for t in tokens[:4]))


def _normalize_phone_digits(phone: str | None) -> str:
    return re.sub(r"\D", "", phone or "")


def _phone_block_key(phone: str | None) -> str | None:
    digits = _normalize_phone_digits(phone)
    return digits[-7:] if len(digits) >= 7 else None


def _normalize_email(email: str | None) -> tuple[str | None, str | None]:
    if not email or "@" not in email:
        return None, None
    local, _, domain = email.strip().lower().partition("@")
    # Heuristic normalization (gmail-style dot/plus stripping) — not
    # universally accurate across providers, but a reasonable default for
    # collapsing "j.smith+jobs@x.com" and "jsmith@x.com" onto one key.
    local_key = local.split("+")[0].replace(".", "")
    return (local_key or None), (domain.strip() or None)


def _hash_value(value: str | None) -> str | None:
    """One-way hash so exact re-use of a device/IP signal is detectable
    without ever persisting the raw value."""
    if not value:
        return None
    return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()[:24]


def _extract_bank_account_last4(text: str) -> str | None:
    match = _BANK_ACCOUNT_PATTERN.search(text or "")
    return match.group(1)[-4:] if match else None


def _validate_dob(raw: str | None) -> str | None:
    """Parses + plausibility-filters an LLM-extracted DOB — an implausible
    age (misparsed date) is dropped rather than trusted as fraud evidence."""
    if not raw:
        return None
    try:
        d = datetime.strptime(raw.strip()[:10], "%Y-%m-%d").date()
    except ValueError:
        return None
    age_years = (date.today() - d).days / 365.25
    return d.isoformat() if 10 <= age_years <= 100 else None


def _identity_logic_checks(email: str | None, phone: str | None, dob: str | None) -> list[dict]:
    """Deterministic, non-ML consistency checks — same spirit as the salary
    slip Field Arithmetic & Logic step, applied to identity fields."""
    checks = []
    if email:
        try:
            validate_email(email, check_deliverability=False)
            checks.append({"rule": "email format is valid", "passed": True, "detail": email})
        except EmailNotValidError as e:
            checks.append({"rule": "email format is valid", "passed": False, "detail": str(e)})
    if phone:
        digits = _normalize_phone_digits(phone)
        ok = 7 <= len(digits) <= 15
        checks.append({"rule": "phone number has a plausible digit count (7-15)", "passed": ok, "detail": f"{len(digits)} digits extracted from '{phone}'"})
    if dob:
        checks.append({"rule": "date of birth implies a plausible age (10-100 years)", "passed": True, "detail": dob})
    return checks


# ─────────────────────────────────────────────────────────────────────────
# Pairwise feature engineering
# ─────────────────────────────────────────────────────────────────────────


def _pairwise_features(a: dict, b: dict) -> list[float]:
    name_a, name_b = _normalize_name(a.get("name")), _normalize_name(b.get("name"))
    if name_a and name_b:
        name_jw = JaroWinkler.normalized_similarity(name_a, name_b)
        name_ts = fuzz.token_sort_ratio(name_a, name_b) / 100.0
    else:
        name_jw = name_ts = 0.0

    pa, pb = a.get("phone_digits") or "", b.get("phone_digits") or ""
    if len(pa) >= 7 and len(pb) >= 7:
        phone_match = 1.0 if pa[-7:] == pb[-7:] else fuzz.ratio(pa[-7:], pb[-7:]) / 100.0
    else:
        phone_match = 0.0

    ela, elb = a.get("email_local") or "", b.get("email_local") or ""
    email_local_sim = (fuzz.ratio(ela, elb) / 100.0) if ela and elb else 0.0

    da, db_ = a.get("email_domain") or "", b.get("email_domain") or ""
    email_domain_match = 1.0 if da and db_ and da == db_ else 0.0

    dob_a, dob_b = a.get("dob"), b.get("dob")
    if dob_a and dob_b:
        dob_match = 1.0 if dob_a == dob_b else (0.5 if dob_a[:7] == dob_b[:7] else 0.0)
    else:
        dob_match = 0.0

    bank_match = 1.0 if a.get("bank_last4") and a.get("bank_last4") == b.get("bank_last4") else 0.0
    device_match = 1.0 if a.get("device_hash") and a.get("device_hash") == b.get("device_hash") else 0.0
    ip_match = 1.0 if a.get("ip_hash") and a.get("ip_hash") == b.get("ip_hash") else 0.0

    return [name_jw, name_ts, phone_match, email_local_sim, email_domain_match, dob_match, bank_match, device_match, ip_match]


# ─────────────────────────────────────────────────────────────────────────
# Synthetic bootstrap training data + the RF/MLP pairwise classifier ensemble
# ─────────────────────────────────────────────────────────────────────────

_FIRST_NAME_VARIANTS = [
    ("mohammed", "muhammad"), ("mohammed", "mohammad"), ("catherine", "katherine"),
    ("stephen", "steven"), ("jon", "john"), ("aisha", "ayesha"), ("fatima", "fatimah"),
    ("sara", "sarah"), ("mariah", "maria"), ("karlos", "carlos"), ("erik", "eric"),
    ("li", "lee"), ("chan", "chen"), ("preeti", "priya"),
]
_FIRST_NAMES = sorted({n for pair in _FIRST_NAME_VARIANTS for n in pair} | {"david", "wei", "raj", "amit", "neha", "james", "olivia"})
_LAST_NAMES = ["khan", "smith", "ali", "chen", "patel", "garcia", "kumar", "lee", "ahmed", "singh", "brown", "wang", "shah", "das"]
_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "proton.me"]


def _random_base_identity(rng: random.Random) -> dict:
    first, last = rng.choice(_FIRST_NAMES), rng.choice(_LAST_NAMES)
    return {
        "name": f"{first} {last}",
        "phone_digits": "".join(str(rng.randint(0, 9)) for _ in range(10)),
        "email_local": f"{first}.{last}{rng.randint(1, 999)}",
        "email_domain": rng.choice(_DOMAINS),
        "dob": f"{rng.randint(1970, 2004):04d}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}",
        "bank_last4": f"{rng.randint(0, 9999):04d}" if rng.random() < 0.5 else None,
        "device_hash": f"dev{rng.randint(0, 999999)}",
        "ip_hash": f"ip{rng.randint(0, 999999)}",
    }


def _same_identity_variant(base: dict, rng: random.Random) -> dict:
    """Generates a second, imperfect application from the SAME real person —
    the kind of positive example an exact-match rule would miss."""
    v = dict(base)
    first, last = base["name"].split(" ", 1)

    name_op = rng.random()
    if name_op < 0.25:
        for a, b in _FIRST_NAME_VARIANTS:
            if first == a:
                first = b
                break
            if first == b:
                first = a
                break
        v["name"] = f"{first} {last}"
    elif name_op < 0.4:
        v["name"] = f"{last} {first}"  # reordered
    elif name_op < 0.55 and len(first) > 3:
        i = rng.randint(1, len(first) - 2)
        first_typo = first[:i] + first[i + 1] + first[i] + first[i + 2:]
        v["name"] = f"{first_typo} {last}"

    if rng.random() < 0.15:
        digits = list(v["phone_digits"])
        digits[rng.randint(0, len(digits) - 1)] = str(rng.randint(0, 9))
        v["phone_digits"] = "".join(digits)
    if rng.random() < 0.1:
        v["phone_digits"] = None

    if rng.random() < 0.5:
        v["email_local"] = f"{first}.{last}{rng.randint(1, 999)}"
        v["email_domain"] = rng.choice(_DOMAINS)

    if rng.random() < 0.08 and v["dob"]:
        y, m, d = v["dob"].split("-")
        v["dob"] = f"{y}-{d}-{m}" if int(d) <= 12 else v["dob"]  # occasional day/month transcription swap
    if rng.random() < 0.15:
        v["dob"] = None

    if rng.random() < 0.5:
        v["device_hash"] = f"dev{rng.randint(0, 999999)}"
        v["ip_hash"] = f"ip{rng.randint(0, 999999)}"

    if rng.random() < 0.3:
        v["bank_last4"] = None

    return v


def _generate_training_data(n_pairs: int = 1500, seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    rng = random.Random(seed)
    X, y = [], []
    for _ in range(n_pairs):
        a = _random_base_identity(rng)
        b = _same_identity_variant(a, rng)
        X.append(_pairwise_features(a, b))
        y.append(1)

        c, d = _random_base_identity(rng), _random_base_identity(rng)
        if rng.random() < 0.1:  # hard negative: coincidental shared email domain
            d["email_domain"] = c["email_domain"]
        X.append(_pairwise_features(c, d))
        y.append(0)
    return np.array(X), np.array(y)


_model_lock = threading.Lock()
_model_cache: dict | None = None


def _get_pairwise_models() -> dict:
    global _model_cache
    if _model_cache is not None:
        return _model_cache
    with _model_lock:
        if _model_cache is not None:
            return _model_cache
        X, y = _generate_training_data()
        rf = RandomForestClassifier(n_estimators=150, max_depth=6, random_state=42, class_weight="balanced")
        rf.fit(X, y)
        mlp = MLPClassifier(hidden_layer_sizes=(16, 8), max_iter=800, random_state=42, early_stopping=True)
        mlp.fit(X, y)
        _model_cache = {
            "rf": rf,
            "mlp": mlp,
            "feature_importance": {n: round(float(v), 3) for n, v in zip(FEATURE_NAMES, rf.feature_importances_)},
        }
        return _model_cache


def _match_probability(a: dict, b: dict) -> tuple[float, list[float]]:
    models = _get_pairwise_models()
    feats = np.array(_pairwise_features(a, b)).reshape(1, -1)
    p_rf = models["rf"].predict_proba(feats)[0][1]
    p_mlp = models["mlp"].predict_proba(feats)[0][1]
    return float((p_rf + p_mlp) / 2), feats[0].tolist()


def _explain_match(feats: list[float]) -> list[str]:
    d = dict(zip(FEATURE_NAMES, feats))
    reasons = []
    if d["phone_match"] >= 0.85:
        reasons.append("same phone number")
    if d["email_domain_match"] >= 1.0 and d["email_local_similarity"] >= 0.8:
        reasons.append("same/near-identical email")
    if d["dob_match"] >= 0.9:
        reasons.append("same date of birth")
    if d["bank_last4_match"] >= 1.0:
        reasons.append("same bank account (last 4 digits)")
    if d["device_signal_match"] >= 1.0:
        reasons.append("same device signal")
    if d["ip_match"] >= 1.0:
        reasons.append("same IP address")
    if d["name_jaro_winkler"] >= 0.999:
        reasons.append("exact name match")
    elif max(d["name_jaro_winkler"], d["name_token_sort"]) >= 0.82:
        reasons.append("name variant (spelling/order)")
    return reasons or ["overall profile similarity"]


# ─────────────────────────────────────────────────────────────────────────
# Blocking + clustering against the identity corpus
# ─────────────────────────────────────────────────────────────────────────


def _blocked_candidates(db, exclude_id: str, name_key, phone_key, email_local_key):
    conditions = [c for c in [
        IdentityRecord.name_key == name_key if name_key else None,
        IdentityRecord.phone_key == phone_key if phone_key else None,
        IdentityRecord.email_local_key == email_local_key if email_local_key else None,
    ] if c is not None]
    if not conditions:
        return []
    return (
        db.query(IdentityRecord)
        .filter(IdentityRecord.id != exclude_id)
        .filter(or_(*conditions))
        .limit(MAX_BLOCKED_CANDIDATES)
        .all()
    )


def _resolve_cluster(db, scan_id: str, matched_records: list[IdentityRecord]) -> str:
    if not matched_records:
        return f"cl_{scan_id}"

    existing_clusters = sorted({r.cluster_id for r in matched_records if r.cluster_id})
    if not existing_clusters:
        canonical = f"cl_{scan_id}"
        ids = [r.id for r in matched_records]
        db.query(IdentityRecord).filter(IdentityRecord.id.in_(ids)).update({"cluster_id": canonical}, synchronize_session=False)
        return canonical

    canonical = existing_clusters[0]
    others = existing_clusters[1:]
    if others:
        db.query(IdentityRecord).filter(IdentityRecord.cluster_id.in_(others)).update({"cluster_id": canonical}, synchronize_session=False)
    return canonical


def _build_match_graph(new_name: str | None, scored: list[dict]) -> dict:
    """Serializes the local identity graph this scan touched — the new
    record as one node, each match as another, edges weighted by the
    ensemble's match probability — for frontend visualization/inspection."""
    graph = nx.Graph()
    graph.add_node("new", label=new_name or "This document", is_new=True)
    for i, m in enumerate(scored):
        node_id = f"match_{i}"
        graph.add_node(node_id, label=m["matched_name"] or "Unknown", is_new=False)
        graph.add_edge("new", node_id, weight=round(m["probability"], 3))
    return {
        "nodes": [{"id": n, **d} for n, d in graph.nodes(data=True)],
        "edges": [{"source": u, "target": v, "weight": d["weight"]} for u, v, d in graph.edges(data=True)],
    }


def _error_step(message: str) -> dict:
    return {
        "key": "identity", "title": "Duplicate Identity Scan", "status": "error", "score": None,
        "summary": message, "details": {},
    }


# ─────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────


def check_identity(scan_id: str, text: str, ip_address: str | None, user_agent: str | None) -> tuple[dict, fraud_llm.ExtractedIdentity | None]:
    """Returns (step_result, extracted_identity) — the extracted identity is
    handed back so fraud_resume_authenticity can reuse it instead of paying
    for a second identity-extraction LLM call on the same document."""
    try:
        extracted = fraud_llm.extract_identity(text or "", langfuse_trace_id=trace_id_for(scan_id))
    except Exception as e:
        return _error_step(f"Identity extraction failed: {e}"), None

    name = (extracted.candidate_name or "").strip() or None
    email = (extracted.email or "").strip() or None
    phone = (extracted.phone or "").strip() or None
    dob = _validate_dob(extracted.date_of_birth)
    bank_last4 = _extract_bank_account_last4(text)

    if not any([name, email, phone, dob, bank_last4]):
        return {
            "key": "identity", "title": "Duplicate Identity Scan", "status": "na", "score": None,
            "summary": "No name, contact, or identity fields could be extracted from this document — nothing to cross-check for duplicate identities.",
            "details": {},
        }, extracted

    email_local, email_domain = _normalize_email(email)
    phone_digits = _normalize_phone_digits(phone) if phone else ""
    device_hash, ip_hash = _hash_value(user_agent), _hash_value(ip_address)

    record_features = {
        "name": name, "phone_digits": phone_digits, "email_local": email_local, "email_domain": email_domain,
        "dob": dob, "bank_last4": bank_last4, "device_hash": device_hash, "ip_hash": ip_hash,
    }
    name_key = _name_block_key(name)
    phone_key = _phone_block_key(phone)

    db = SessionLocal()
    try:
        try:
            candidates = _blocked_candidates(db, scan_id, name_key, phone_key, email_local)

            scored = []
            for cand in candidates:
                cand_features = {
                    "name": cand.full_name, "phone_digits": _normalize_phone_digits(cand.phone or ""),
                    "email_local": cand.email_local_key, "email_domain": cand.email_domain,
                    "dob": cand.date_of_birth, "bank_last4": cand.bank_account_last4,
                    "device_hash": cand.device_fingerprint_hash, "ip_hash": cand.ip_hash,
                }
                prob, feats = _match_probability(record_features, cand_features)
                if prob >= MATCH_THRESHOLD:
                    # Capture matched_name now, while `cand` is still attached to
                    # this session — db.commit() below expires every loaded ORM
                    # instance (SQLAlchemy's default expire_on_commit), and the
                    # session is closed shortly after, so re-reading cand.full_name
                    # later would raise DetachedInstanceError.
                    scored.append({"record": cand, "probability": prob, "features": feats, "matched_name": cand.full_name})
            scored.sort(key=lambda m: -m["probability"])

            matched_records = [m["record"] for m in scored]
            cluster_id = _resolve_cluster(db, scan_id, matched_records)

            db.merge(IdentityRecord(
                id=scan_id, full_name=name, name_key=name_key, email=email,
                email_local_key=email_local, email_domain=email_domain, phone=phone, phone_key=phone_key,
                date_of_birth=dob, bank_account_last4=bank_last4,
                device_fingerprint_hash=device_hash, ip_hash=ip_hash, cluster_id=cluster_id,
            ))
            db.commit()

            cluster_size = db.query(IdentityRecord).filter(IdentityRecord.cluster_id == cluster_id).count()
            candidates_blocked = len(candidates)
            models = _get_pairwise_models()
        except Exception as e:
            db.rollback()
            return _error_step(f"Identity matching failed: {e}"), extracted
    finally:
        db.close()

    logic_checks = _identity_logic_checks(email, phone, dob)
    matches_payload = [
        {
            "matched_name": m["matched_name"],
            "probability": round(m["probability"], 3),
            "reasons": _explain_match(m["features"]),
        }
        for m in scored[:5]
    ]

    high_conf = [m for m in scored if m["probability"] >= HIGH_CONFIDENCE_THRESHOLD]
    if not scored:
        status, score = "pass", 100
        summary = "No matching identity found among prior submissions — this looks like a new, distinct identity."
    elif high_conf:
        status = "fail"
        score = max(0, round(100 - high_conf[0]["probability"] * 100))
        top = matches_payload[0]
        summary = f"High-confidence match ({top['probability']*100:.0f}%) with a previously submitted identity — {', '.join(top['reasons'])}. Likely the same person under a different identity."
    else:
        status = "warn"
        score = max(0, round(100 - scored[0]["probability"] * 100))
        summary = f"{len(scored)} possible duplicate identit{'y' if len(scored) == 1 else 'ies'} found with moderate similarity ({matches_payload[0]['reasons'][0]}) — worth a manual look, not conclusive alone."

    failed_logic = [c for c in logic_checks if not c["passed"]]
    if failed_logic and status == "pass":
        status, score = "warn", min(score, 70)
        summary += f" Also flagged: {failed_logic[0]['rule']} ({failed_logic[0]['detail']})."

    return {
        "key": "identity",
        "title": "Duplicate Identity Scan",
        "status": status,
        "score": score,
        "summary": summary,
        "details": {
            "extracted_name": name,
            "candidates_blocked": candidates_blocked,
            "matches": matches_payload,
            "identity_cluster_size": cluster_size,
            "logic_checks": logic_checks,
            "model_feature_importance": models["feature_importance"],
            "graph": _build_match_graph(name, scored),
        },
    }, extracted
