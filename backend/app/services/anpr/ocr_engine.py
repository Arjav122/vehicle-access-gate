"""Plate crop preprocessing + PaddleOCR (primary) with EasyOCR fallback for Indian-style plates."""

from __future__ import annotations

import logging
import os
import re
from collections import defaultdict

import numpy as np

from app.services.anpr.paddle_reader import paddle_read_lines
from app.utils.plates import looks_like_plate, normalize_plate, refine_indian_plate_ocr

logger = logging.getLogger(__name__)

# New Indian format: e.g. MH12AB1234, DL01CA1111 (2 letters + 2 digit + 1-2 letters + 4 digit)
_INDIAN_NEW = re.compile(r"^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$")
_INDIAN_LOOSE = re.compile(r"^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{2,4}[A-Z0-9]{0,4}$")

_easy_reader = None


def _get_easy_reader():
    global _easy_reader
    if _easy_reader is not None:
        return _easy_reader
    import easyocr

    _easy_reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    return _easy_reader


def _ocr_engine_mode() -> str:
    return os.environ.get("ANPR_OCR_ENGINE", "auto").strip().lower()


def _easy_read_lines(img: np.ndarray, *, allowlist: str) -> list[tuple[str, float]]:
    reader = _get_easy_reader()
    out: list[tuple[str, float]] = []
    for bbox, text, conf in reader.readtext(
        img,
        detail=1,
        paragraph=False,
        allowlist=allowlist,
    ):
        out.append((str(text), float(conf)))
    return out


def _read_lines_from_image(img: np.ndarray, *, allowlist: str) -> list[tuple[str, float]]:
    """``easy``: EasyOCR only. ``paddle``: Paddle only. ``auto`` (default): Paddle then EasyOCR fallback."""
    mode = _ocr_engine_mode()
    if mode == "easy":
        return _easy_read_lines(img, allowlist=allowlist)
    if mode == "paddle":
        return paddle_read_lines(img)
    lines = paddle_read_lines(img)
    if lines:
        return lines
    logger.info("PaddleOCR returned no lines; trying EasyOCR fallback.")
    try:
        return _easy_read_lines(img, allowlist=allowlist)
    except Exception as e:  # noqa: BLE001
        logger.warning("EasyOCR fallback failed: %s", e)
        return []


def _deskew_gray(gray: np.ndarray) -> np.ndarray:
    """Small skew correction from dominant plate-like contour (helps tilted crops)."""
    import cv2

    h, w = gray.shape[:2]
    if min(h, w) < 20:
        return gray
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(th, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return gray
    c = max(contours, key=cv2.contourArea)
    if cv2.contourArea(c) < (h * w * 0.05):
        return gray
    rect = cv2.minAreaRect(c)
    angle = float(rect[-1])
    if angle < -45.0:
        angle += 90.0
    if abs(angle) < 0.6 or abs(angle) > 18.0:
        return gray
    m = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle, 1.0)
    return cv2.warpAffine(
        gray,
        m,
        (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def preprocess_for_ocr(bgr_crop: np.ndarray) -> tuple[np.ndarray, str]:
    """
    Grayscale, bilateral denoise, CLAHE, mild unsharp, upscale for OCR.
    Returns (single-channel uint8 image for readtext, description).
    """
    import cv2

    if bgr_crop.size == 0:
        return np.zeros((1, 1), dtype=np.uint8), "empty_crop"

    gray = cv2.cvtColor(bgr_crop, cv2.COLOR_BGR2GRAY)
    gray = _deskew_gray(gray)
    gray = cv2.bilateralFilter(gray, d=7, sigmaColor=55, sigmaSpace=55)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    blur = cv2.GaussianBlur(gray, (0, 0), sigmaX=1.2)
    gray = cv2.addWeighted(gray, 1.35, blur, -0.35, 0)

    h, w = gray.shape[:2]
    target_h = int(os.environ.get("ANPR_OCR_TARGET_H", "104"))
    if h < target_h and h > 0:
        scale = target_h / float(h)
        nw = max(8, int(round(w * scale)))
        gray = cv2.resize(gray, (nw, target_h), interpolation=cv2.INTER_CUBIC)

    note = f"gray+deskew+bilateral+CLAHE+unsharp+resize{target_h}h"
    return gray, note


def _threshold_variant(gray: np.ndarray) -> np.ndarray:
    import cv2

    th = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        9,
    )
    kernel = np.ones((2, 2), dtype=np.uint8)
    return cv2.morphologyEx(th, cv2.MORPH_CLOSE, kernel)


def _rotate_variant(gray: np.ndarray, angle_deg: float) -> np.ndarray:
    import cv2

    h, w = gray.shape[:2]
    center = (w / 2.0, h / 2.0)
    m = cv2.getRotationMatrix2D(center, angle_deg, 1.0)
    return cv2.warpAffine(
        gray,
        m,
        (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def _indian_plate_score(norm: str) -> float:
    if not norm:
        return 0.0
    if _INDIAN_NEW.match(norm):
        return 1.0
    if _INDIAN_LOOSE.match(norm) and 8 <= len(norm) <= 14:
        return 0.75
    if looks_like_plate(norm):
        return 0.35
    return 0.1


def read_texts_from_gray(
    gray: np.ndarray,
    *,
    allowlist: str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
) -> list[tuple[str, float]]:
    return _read_lines_from_image(gray, allowlist=allowlist)


def read_plate_from_crops(
    crops_with_conf: list[tuple[np.ndarray, float]],
    *,
    allowlist: str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
) -> tuple[str | None, float | None, list[str], str | None]:
    """
    OCR each crop; pick best by (Indian pattern score, OCR conf, detection conf).
    Returns (plate_text, ocr_confidence, candidates, preprocessing_note).
    """
    all_reads: list[tuple[str, float, float, str]] = []

    for crop_bgr, det_conf in crops_with_conf[:2]:
        proc, note = preprocess_for_ocr(crop_bgr)
        variants = [
            (proc, note),
            (_threshold_variant(proc), f"{note}+adaptive_threshold"),
            (_rotate_variant(proc, -3.0), f"{note}+rot-3"),
            (_rotate_variant(proc, 3.0), f"{note}+rot+3"),
        ]
        for img, variant_note in variants:
            try:
                for raw, conf in _read_lines_from_image(img, allowlist=allowlist):
                    norm = normalize_plate(str(raw or ""))
                    if not norm:
                        continue
                    refined = refine_indian_plate_ocr(norm)
                    for n in {norm, refined}:
                        all_reads.append((n, float(conf), det_conf, variant_note))
            except Exception as exc:  # noqa: BLE001
                logger.warning("OCR pass failed on crop variant: %s", exc)

    if not all_reads:
        return None, None, [], None

    score_map: dict[str, float] = defaultdict(float)
    best_conf_map: dict[str, float] = defaultdict(float)
    note_map: dict[str, str] = {}
    for norm, ocr_c, det_c, note in all_reads:
        pattern = _indian_plate_score(norm)
        weighted = (ocr_c * 0.55) + (det_c * 0.25) + (pattern * 0.20)
        score_map[norm] += weighted
        if ocr_c > best_conf_map[norm]:
            best_conf_map[norm] = ocr_c
            note_map[norm] = note

    candidates = sorted(score_map.keys(), key=lambda t: score_map[t], reverse=True)

    top_key = candidates[0]
    best_norm = refine_indian_plate_ocr(top_key)
    ocr_conf_out = max(
        best_conf_map.get(top_key, 0.0),
        best_conf_map.get(best_norm, 0.0),
    )
    note_out = note_map.get(top_key) or note_map.get(best_norm)
    ordered_cands = list(dict.fromkeys([best_norm] + candidates))
    return best_norm, ocr_conf_out or None, ordered_cands, note_out
