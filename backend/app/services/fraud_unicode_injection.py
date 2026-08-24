"""
Unicode, Homoglyph & Hidden Prompt Injection Detection Service.

Detects:
1. Zero-width & invisible characters:
   - Zero-width space (\u200b), zero-width non-joiner (\u200c), zero-width joiner (\u200d),
     BOM / zero-width no-break space (\ufeff), word joiner (\u2060), soft hyphen (\u00ad).
2. Cyrillic & Greek homoglyph character substitutions inside English words:
   - e.g. Cyrillic 'а', 'е', 'о', 'р', 'с', 'х' spoofing Latin letters.
3. Adversarial / Prompt Injections inside document text layers:
   - e.g. "Ignore previous instructions", "system prompt", "give 100% score", etc.
"""

import re
import unicodedata

# Invisible and zero-width code points
ZERO_WIDTH_CHARS = {
    "\u200b": "Zero-Width Space",
    "\u200c": "Zero-Width Non-Joiner",
    "\u200d": "Zero-Width Joiner",
    "\u2060": "Word Joiner",
    "\ufeff": "Byte Order Mark / Zero-Width No-Break Space",
    "\u00ad": "Soft Hyphen",
    "\u200e": "Left-to-Right Mark",
    "\u200f": "Right-to-Left Mark",
    "\u202a": "Left-to-Right Embedding",
    "\u202b": "Right-to-Left Embedding",
    "\u202c": "Pop Directional Formatting",
    "\u202d": "Left-to-Right Override",
    "\u202e": "Right-to-Left Override",
}

# Common Cyrillic and Greek lookalikes for Latin characters
HOMOGLYPH_LOOKALIKES = {
    # Cyrillic
    "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c",
    "\u0443": "y", "\u0445": "x", "\u0456": "i", "\u0458": "j", "\u0410": "A",
    "\u0412": "B", "\u0415": "E", "\u041a": "K", "\u041c": "M", "\u041d": "H",
    "\u041e": "O", "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0425": "X",
    # Greek
    "\u03b1": "a", "\u03b5": "e", "\u03bf": "o", "\u03c1": "p", "\u03c5": "u",
    "\u03bd": "v", "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0397": "H",
    "\u0399": "I", "\u039a": "K", "\u039c": "M", "\u039d": "N", "\u039f": "O",
    "\u03a1": "P", "\u03a4": "T", "\u03a7": "X", "\u03a5": "Y", "\u0396": "Z",
}

PROMPT_INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions", re.IGNORECASE),
    re.compile(r"system\s*prompt\s*:", re.IGNORECASE),
    re.compile(r"you\s+must\s+rate\s+this\s+(?:candidate|resume)\s+as\s+(?:high|10|perfect|100%|hire)", re.IGNORECASE),
    re.compile(r"override\s+(?:all\s+)?(?:rules|policies|evaluations)", re.IGNORECASE),
    re.compile(r"give\s+a\s+score\s+of\s+(?:100|10/10|perfect)", re.IGNORECASE),
    re.compile(r"do\s+not\s+(?:penalize|fail|flag)\s+this\s+(?:document|candidate)", re.IGNORECASE),
]


def check_unicode_and_injections(text: str) -> dict:
    """
    Scans the extracted text for zero-width characters, homoglyphs, and prompt injections.
    """
    if not text:
        return {
            "key": "unicode_injection",
            "title": "Invisible Text & Injection Defense",
            "status": "passed",
            "score": 0.0,
            "summary": "No text content to analyze.",
            "details": {},
        }

    flags = []
    risk_score = 0.0

    # 1. Zero-width character count
    zero_width_counts = {}
    total_zero_width = 0
    for char in text:
        if char in ZERO_WIDTH_CHARS:
            name = ZERO_WIDTH_CHARS[char]
            zero_width_counts[name] = zero_width_counts.get(name, 0) + 1
            total_zero_width += 1

    if total_zero_width > 5:
        flags.append(f"Detected {total_zero_width} invisible zero-width characters (possible hidden text or anti-ATS stuffing).")
        risk_score += min(0.60, 0.20 + (total_zero_width * 0.02))

    # 2. Homoglyph substitution scan inside English words
    words = text.split()
    homoglyph_findings = []
    for w in words:
        has_latin = any(unicodedata.name(c, "").startswith("LATIN") for c in w)
        has_homoglyph = any(c in HOMOGLYPH_LOOKALIKES for c in w)
        if has_latin and has_homoglyph and len(w) > 2:
            homoglyph_findings.append(w)

    if len(homoglyph_findings) >= 2:
        flags.append(f"Detected mixed-script homoglyphs in {len(homoglyph_findings)} word(s) (e.g. '{homoglyph_findings[0]}') — indicative of spoofed text or domain obfuscation.")
        risk_score += 0.50

    # 3. Hidden Prompt Injection Scan
    injections_found = []
    for pattern in PROMPT_INJECTION_PATTERNS:
        match = pattern.search(text)
        if match:
            injections_found.append(match.group(0))

    if injections_found:
        flags.append(f"Adversarial Prompt Injection attempt detected: '{injections_found[0]}'.")
        risk_score += 0.85

    if flags:
        return {
            "key": "unicode_injection",
            "title": "Invisible Text & Injection Defense",
            "status": "flagged",
            "score": min(1.0, risk_score),
            "summary": f"Security Alert: {'; '.join(flags)}",
            "details": {
                "zero_width_count": total_zero_width,
                "zero_width_breakdown": zero_width_counts,
                "homoglyph_words_count": len(homoglyph_findings),
                "prompt_injections": injections_found,
                "flags": flags,
            },
        }

    return {
        "key": "unicode_injection",
        "title": "Invisible Text & Injection Defense",
        "status": "passed",
        "score": 0.0,
        "summary": "Clean document: no zero-width characters, homoglyphs, or prompt injections detected.",
        "details": {
            "zero_width_count": 0,
            "homoglyph_words_count": 0,
            "prompt_injections": [],
        },
    }
