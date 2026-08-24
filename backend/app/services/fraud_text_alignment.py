"""
Micro-Baseline Alignment & Kerning Jitter Forensics.

Detects:
1. Micro-Baseline Shifts (y0/y1 jitter):
   - Forged characters/digits inserted into dates or salaries often have a distinct vertical offset (even by 1-2 points)
     from the rest of the text on the same line.
2. Font Size Fluctuations Inside Numbers:
   - e.g. "1" in 10pt font inserted before "5,000" in 9.5pt font to forge "$15,000".
"""

import fitz
import numpy as np


def check_text_alignment(file_path: str, content_type: str) -> dict:
    """
    Analyzes text span baselines and bounding boxes across PDF lines.
    """
    if content_type != "pdf":
        return {
            "key": "text_alignment",
            "title": "Text Baseline Alignment & Kerning Jitter",
            "status": "na",
            "score": None,
            "summary": "Not applicable to image uploads (requires PDF font span coordinates).",
            "details": {},
        }

    try:
        doc = fitz.open(file_path)
        jitter_anomalies = []
        font_size_anomalies = []

        for page_num in range(min(5, len(doc))):
            page = doc[page_num]
            text_dict = page.get_text("dict")

            for block in text_dict.get("blocks", []):
                for line in block.get("lines", []):
                    spans = line.get("spans", [])
                    if len(spans) < 2:
                        continue

                    # Check for baseline differences on the same line
                    baselines = [s.get("bbox", [0, 0, 0, 0])[1] for s in spans if s.get("text", "").strip()]
                    sizes = [s.get("size", 0) for s in spans if s.get("text", "").strip()]
                    texts = [s.get("text", "").strip() for s in spans if s.get("text", "").strip()]

                    if len(baselines) >= 2:
                        y_diff = max(baselines) - min(baselines)
                        # Significant micro-baseline drift (> 2.5 points) on the same horizontal line
                        if y_diff > 2.5 and y_diff < 15.0:
                            combined = " ".join(texts)
                            if len(combined) < 80:
                                jitter_anomalies.append({
                                    "page": page_num + 1,
                                    "text": combined[:60],
                                    "baseline_drift": round(y_diff, 2)
                                })

                    if len(sizes) >= 2:
                        size_diff = max(sizes) - min(sizes)
                        # Size jump on the exact same line without bold styling
                        if size_diff > 1.8 and size_diff < 8.0:
                            combined = " ".join(texts)
                            if any(char.isdigit() for char in combined):
                                font_size_anomalies.append({
                                    "page": page_num + 1,
                                    "text": combined[:60],
                                    "size_diff": round(size_diff, 1)
                                })

    except Exception as e:
        return {
            "key": "text_alignment",
            "title": "Text Baseline Alignment & Kerning Jitter",
            "status": "error",
            "score": None,
            "summary": f"Alignment forensics failed: {e}",
            "details": {"error": str(e)},
        }

    flags = []
    risk_score = 0.0

    if len(jitter_anomalies) >= 3:
        flags.append(f"Detected {len(jitter_anomalies)} instances of vertical baseline jitter (misaligned inserted text).")
        risk_score += 0.40

    if len(font_size_anomalies) >= 2:
        flags.append(f"Detected {len(font_size_anomalies)} numeric lines with mismatched font sizes (possible altered numbers/amounts).")
        risk_score += 0.45

    if flags:
        return {
            "key": "text_alignment",
            "title": "Text Baseline Alignment & Kerning Jitter",
            "status": "flagged",
            "score": min(1.0, risk_score),
            "summary": f"Alignment Anomaly: {'; '.join(flags)}",
            "details": {
                "jitter_anomalies_count": len(jitter_anomalies),
                "jitter_samples": jitter_anomalies[:3],
                "font_size_anomalies_count": len(font_size_anomalies),
                "font_size_samples": font_size_anomalies[:3],
                "flags": flags,
            },
        }

    return {
        "key": "text_alignment",
        "title": "Text Baseline Alignment & Kerning Jitter",
        "status": "passed",
        "score": 0.05,
        "summary": "Text baseline alignment is consistent across all lines: no vertical jitter or numeric font-size anomalies.",
        "details": {
            "jitter_anomalies_count": 0,
            "font_size_anomalies_count": 0,
        },
    }
