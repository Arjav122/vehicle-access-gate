"""Lazy PaddleOCR singleton for plate crop recognition (CPU-friendly)."""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

_paddle_ocr: Any = None
_paddle_init_failed: bool = False


def get_paddle_ocr() -> Any:
    """Return PaddleOCR instance or None if import/init failed."""
    global _paddle_ocr, _paddle_init_failed
    if _paddle_init_failed:
        return None
    if _paddle_ocr is not None:
        return _paddle_ocr
    try:
        from paddleocr import PaddleOCR
    except ImportError as e:
        logger.warning("PaddleOCR not installed: %s. Use pip install paddleocr paddlepaddle or set ANPR_OCR_ENGINE=easy", e)
        _paddle_init_failed = True
        return None
    try:
        # cls=False: faster on plate crops; det+rec for multi-line embossed plates.
        _paddle_ocr = PaddleOCR(
            use_angle_cls=True,
            lang="en",
            show_log=False,
            use_gpu=False,
        )
        logger.info("PaddleOCR reader initialized (English).")
    except Exception as e:  # noqa: BLE001
        logger.exception("PaddleOCR init failed: %s", e)
        _paddle_init_failed = True
        return None
    return _paddle_ocr


def paddle_read_lines(img: np.ndarray) -> list[tuple[str, float]]:
    """
    Run detection + recognition on a single image (BGR or grayscale uint8).
    Returns list of (raw_text, confidence) for each detected line.
    """
    import cv2

    if img.size == 0:
        return []
    if img.ndim == 2:
        bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    else:
        bgr = img

    ocr = get_paddle_ocr()
    if ocr is None:
        return []

    try:
        res = ocr.ocr(bgr, cls=False)
    except TypeError:
        # Older PaddleOCR may not accept cls= on ocr()
        res = ocr.ocr(bgr)
    except Exception as e:  # noqa: BLE001
        logger.warning("PaddleOCR ocr() failed: %s", e)
        return []

    out: list[tuple[str, float]] = []
    if not res:
        return out
    first = res[0]
    if first is None:
        return out
    for item in first:
        if not item or len(item) < 2:
            continue
        text_info = item[1]
        if not text_info or len(text_info) < 2:
            continue
        text, conf = str(text_info[0]), float(text_info[1])
        out.append((text, conf))
    return out
