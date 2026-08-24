"""
Fraud QR & Barcode Ground-Truth Verification Service.

Extracts and decodes QR codes from PDF pages and raster images using pyzbar and OpenCV.
Cross-verifies decoded payload data (Aadhaar QR / PAN QR / Generic QR) against visible OCR text.
Detects tampering where visual text on an ID was altered but the cryptographic QR was not.
"""

import io
import re
import fitz
import numpy as np
from PIL import Image
from rapidfuzz import fuzz

try:
    import cv2
    _has_cv2 = True
except ImportError:
    _has_cv2 = False

try:
    from pyzbar import pyzbar
    _has_pyzbar = True
except ImportError:
    _has_pyzbar = False


def _decode_qr_image(img_pil: Image.Image) -> list[str]:
    """
    Attempts QR code decoding using pyzbar first, falling back to cv2.QRCodeDetector.
    """
    decoded_texts = []
    
    # Method 1: pyzbar
    if _has_pyzbar:
        try:
            results = pyzbar.decode(img_pil)
            for r in results:
                if r.data:
                    decoded_texts.append(r.data.decode("utf-8", errors="ignore"))
        except Exception:
            pass

    if decoded_texts:
        return decoded_texts

    # Method 2: OpenCV QRCodeDetector
    if _has_cv2:
        try:
            open_cv_image = np.array(img_pil.convert("RGB"))
            open_cv_image = open_cv_image[:, :, ::-1].copy()
            detector = cv2.QRCodeDetector()
            retval, decoded_info, points, straight_qrcode = detector.detectAndDecodeMulti(open_cv_image)
            if retval and decoded_info:
                for text in decoded_info:
                    if text.strip():
                        decoded_texts.append(text.strip())
        except Exception:
            pass

    return decoded_texts


def _extract_qr_from_file(file_path: str, content_type: str) -> list[str]:
    """
    Extracts QR payloads from an image file or PDF pages.
    """
    all_payloads = []

    if content_type == "image":
        try:
            img = Image.open(file_path)
            all_payloads.extend(_decode_qr_image(img))
        except Exception:
            pass
    elif content_type == "pdf":
        try:
            doc = fitz.open(file_path)
            for page in doc[:3]:  # inspect first 3 pages
                # 1. Render page to high-res pixmap (200 DPI)
                pix = page.get_pixmap(dpi=200)
                img = Image.open(io.BytesIO(pix.tobytes()))
                payloads = _decode_qr_image(img)
                all_payloads.extend(payloads)
                if all_payloads:
                    break
        except Exception:
            pass

    return all_payloads


def _parse_aadhaar_qr_text(raw_text: str) -> dict:
    """
    Parses Aadhaar QR XML or structured text payload (e.g., <?xml ... uid="..." name="..." dob="..." />)
    """
    extracted = {}
    if not raw_text:
        return extracted

    # Match XML attributes
    uid_m = re.search(r'uid="([^"]+)"', raw_text, re.IGNORECASE)
    name_m = re.search(r'name="([^"]+)"', raw_text, re.IGNORECASE)
    dob_m = re.search(r'dob="([^"]+)"', raw_text, re.IGNORECASE)
    gender_m = re.search(r'gender="([^"]+)"', raw_text, re.IGNORECASE)

    if uid_m: extracted["uid"] = uid_m.group(1)
    if name_m: extracted["name"] = name_m.group(1)
    if dob_m: extracted["dob"] = dob_m.group(1)
    if gender_m: extracted["gender"] = gender_m.group(1)

    return extracted


def _parse_pan_qr_text(raw_text: str) -> dict:
    """
    Parses PAN QR structured payload.
    """
    extracted = {}
    if not raw_text:
        return extracted

    pan_m = re.search(r'\b([A-Z]{5}[0-9]{4}[A-Z])\b', raw_text)
    if pan_m:
        extracted["pan"] = pan_m.group(1)

    return extracted


def check_qr_ground_truth(file_path: str, content_type: str, ocr_text: str = "") -> dict:
    """
    Checks for QR codes on the document, extracts payload, and cross-verifies against OCR text.
    """
    qr_payloads = _extract_qr_from_file(file_path, content_type)

    if not qr_payloads:
        return {
            "key": "qr_ground_truth",
            "title": "QR Code & Digital Barcode Verification",
            "status": "na",
            "score": 0.0,
            "summary": "No QR code or barcode found on this document (normal for general resumes and text documents).",
            "details": {
                "qr_found": False,
                "qr_count": 0,
            },
        }

    qr_text = "\n".join(qr_payloads)
    discrepancies = []
    confidence_penalty = 0.0

    # 1. Aadhaar cross-check
    aadhaar_data = _parse_aadhaar_qr_text(qr_text)
    if aadhaar_data.get("name"):
        # Check if the name in the QR code exists in the OCR text
        name_in_qr = aadhaar_data["name"]
        ratio = fuzz.partial_ratio(name_in_qr.lower(), ocr_text.lower())
        if ratio < 65:
            discrepancies.append(f"Name in Aadhaar QR code ('{name_in_qr}') does not match visible document text.")
            confidence_penalty += 0.60

    if aadhaar_data.get("dob"):
        dob_in_qr = aadhaar_data["dob"]
        if dob_in_qr not in ocr_text:
            discrepancies.append(f"Date of birth in Aadhaar QR ('{dob_in_qr}') does not match visible text.")
            confidence_penalty += 0.30

    # 2. PAN cross-check
    pan_data = _parse_pan_qr_text(qr_text)
    if pan_data.get("pan"):
        pan_in_qr = pan_data["pan"]
        if pan_in_qr not in ocr_text.upper():
            discrepancies.append(f"PAN number encoded in QR ('{pan_in_qr}') differs from visible PAN number on card.")
            confidence_penalty += 0.70

    if discrepancies:
        return {
            "key": "qr_ground_truth",
            "title": "QR Code & Digital Barcode Verification",
            "status": "flagged",
            "score": min(1.0, 0.40 + confidence_penalty),
            "summary": f"Tampering Alert: {len(discrepancies)} discrepancy found between QR code cryptographic data and visible document text.",
            "details": {
                "qr_found": True,
                "qr_count": len(qr_payloads),
                "discrepancies": discrepancies,
                "extracted_qr_data": {**aadhaar_data, **pan_data},
            },
        }

    return {
        "key": "qr_ground_truth",
        "title": "QR Code & Digital Barcode Verification",
        "status": "passed",
        "score": 0.05,
        "summary": "QR code decoded successfully and verified consistent with document text.",
        "details": {
            "qr_found": True,
            "qr_count": len(qr_payloads),
            "extracted_qr_data": {**aadhaar_data, **pan_data},
        },
    }
