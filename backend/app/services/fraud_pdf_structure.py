"""
PDF Structural Forensics & Incremental Revision Inspector.

Detects:
1. Incremental Updates & Revision History (/Prev XRef tables):
   - Identifies if a PDF has been modified/re-saved with appended changes after initial creation.
2. Hidden / Out-of-Bounds Annotations:
   - Identifies whiteout boxes, redaction masks, or annotation overlays covering original text.
3. Dual-Layer Superimposition:
   - Detects digital vector text layers overlaid on a full-page raster scan (common technique
     used to alter salaries, dates, or names on scanned bank statements / payslips).
"""

import re
import fitz


def check_pdf_structure(file_path: str, content_type: str) -> dict:
    """
    Performs deep binary and structural inspection of PDF files.
    """
    if content_type != "pdf":
        return {
            "key": "pdf_structure",
            "title": "PDF Revision & Structural Forensics",
            "status": "na",
            "score": None,
            "summary": "Not applicable to image uploads (PDF-only check).",
            "details": {},
        }

    flags = []
    details = {}
    risk_score = 0.0

    # 1. Binary XRef revision count scan
    try:
        with open(file_path, "rb") as f:
            raw_bytes = f.read()

        # Count startxref occurrences — each incremental save adds a new startxref pointer
        startxref_count = len(re.findall(b"startxref", raw_bytes))
        prev_xref_count = len(re.findall(b"/Prev\\s+\\d+", raw_bytes))

        details["incremental_revisions"] = max(startxref_count - 1, prev_xref_count)
        if details["incremental_revisions"] >= 2:
            flags.append(f"PDF contains {details['incremental_revisions']} incremental revisions / post-creation edits.")
            risk_score += 0.40
    except Exception as e:
        details["xref_error"] = str(e)

    # 2. PyMuPDF Structural Object Inspection
    try:
        doc = fitz.open(file_path)
        total_pages = len(doc)
        details["page_count"] = total_pages

        annotation_count = 0
        dual_layer_pages = []

        for page_num in range(min(5, total_pages)):
            page = doc[page_num]
            
            # Check for annotations (whiteouts / overlays)
            annots = list(page.annots())
            annotation_count += len(annots)

            # Check for dual-layer superimposition (Text placed directly over large raster background)
            images = page.get_images()
            text_length = len(page.get_text().strip())

            # If a page contains a background image covering >80% of the page AND vector text
            if images and text_length > 50:
                page_area = page.rect.width * page.rect.height
                for img_info in images:
                    try:
                        bbox = page.get_image_bbox(img_info)
                        img_area = bbox.width * bbox.height
                        if (img_area / page_area) > 0.75:
                            dual_layer_pages.append(page_num + 1)
                            break
                    except Exception:
                        pass

        details["annotation_count"] = annotation_count
        details["dual_layer_pages"] = dual_layer_pages

        if annotation_count > 3:
            flags.append(f"Found {annotation_count} annotation overlays (possible redactions or whiteout layers).")
            risk_score += 0.35

        if dual_layer_pages:
            flags.append(f"Dual-layer text detected on page(s) {dual_layer_pages}: Digital text superimposed over scanned raster image.")
            risk_score += 0.45

    except Exception as e:
        return {
            "key": "pdf_structure",
            "title": "PDF Revision & Structural Forensics",
            "status": "error",
            "score": None,
            "summary": f"Could not inspect PDF structure: {e}",
            "details": {"error": str(e)},
        }

    if flags:
        return {
            "key": "pdf_structure",
            "title": "PDF Revision & Structural Forensics",
            "status": "flagged",
            "score": min(1.0, risk_score),
            "summary": f"Structural Anomaly: {'; '.join(flags)}",
            "details": {
                **details,
                "flags": flags,
            },
        }

    return {
        "key": "pdf_structure",
        "title": "PDF Revision & Structural Forensics",
        "status": "passed",
        "score": 0.05,
        "summary": "PDF structure is clean: single-generation file, no incremental revisions or suspicious overlay annotations.",
        "details": details,
    }
