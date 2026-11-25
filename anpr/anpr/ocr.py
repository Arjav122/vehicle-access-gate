"""Read the text on a plate crop (brief §11.3).

Crop with a small margin → grayscale → upscale → (optional) CLAHE contrast → OCR.
PaddleOCR runs detection + recognition on the crop. It may return a plate as several pieces:
two rows on a two-wheeler plate, or "22" / "BH" / "1234AA" side by side. We group pieces into
rows, read rows top to bottom, and each row left to right.

The worker only drops a line that is just the HSRP "IND" mark. All other repair (O→0 etc.)
happens on the server, in one place.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np

from anpr.detector import Box

TARGET_HEIGHT = 96
_IND_ONLY = re.compile(r"^[I1L]N[D0O]$")


@dataclass(frozen=True)
class Line:
    """One piece of text the OCR found, with where it is in the crop (for reading order)."""

    text: str
    confidence: float
    top: float
    left: float = 0.0
    height: float = 1.0


@dataclass(frozen=True)
class PlateText:
    text: str
    confidence: float


class OcrEngine(Protocol):
    def read_lines(self, image: np.ndarray) -> list[Line]: ...


def crop(bgr: np.ndarray, box: Box, margin: float = 0.08) -> np.ndarray:
    """The plate region plus a small margin (OCR misses edge characters on tight crops)."""
    h, w = bgr.shape[:2]
    mx, my = (box.x2 - box.x1) * margin, (box.y2 - box.y1) * margin
    x1, y1 = max(0, int(box.x1 - mx)), max(0, int(box.y1 - my))
    x2, y2 = min(w, int(box.x2 + mx)), min(h, int(box.y2 + my))
    return bgr[y1:y2, x1:x2].copy()


def preprocess(crop_bgr: np.ndarray, contrast: bool = False) -> np.ndarray:
    """Grayscale, scale to a readable height, optionally boost local contrast (CLAHE)."""
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY) if crop_bgr.ndim == 3 else crop_bgr
    h, w = gray.shape[:2]
    if h and h != TARGET_HEIGHT:
        scale = TARGET_HEIGHT / h
        interp = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
        gray = cv2.resize(gray, (max(1, round(w * scale)), TARGET_HEIGHT), interpolation=interp)
    if contrast:
        gray = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(gray)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def reading_order(lines: list[Line]) -> list[Line]:
    """Rows top to bottom; within a row, left to right. A piece starts a new row when its top
    is more than half a line height below the current row's top."""
    rows: list[list[Line]] = []
    for line in sorted(lines, key=lambda ln: ln.top):
        row = rows[-1] if rows else None
        if row and line.top - row[0].top <= max(row[0].height, line.height) / 2:
            row.append(line)
        else:
            rows.append([line])
    return [ln for row in rows for ln in sorted(row, key=lambda ln: ln.left)]


def combine(lines: list[Line]) -> PlateText | None:
    """Join pieces in reading order, dropping a piece that is only the IND mark.

    Confidence is the lowest piece confidence: a plate is only as sure as its least sure part.
    """
    kept = []
    for line in reading_order(lines):
        cleaned = re.sub(r"[^A-Z0-9]", "", line.text.upper())
        if cleaned and not _IND_ONLY.match(cleaned):
            kept.append((cleaned, line.confidence))
    if not kept:
        return None
    return PlateText(text="".join(t for t, _ in kept), confidence=min(c for _, c in kept))


# The small "mobile" models: plate crops are tiny, and these are faster on a laptop CPU.
DET_MODEL = "PP-OCRv5_mobile_det"
REC_MODEL = "PP-OCRv5_mobile_rec"


class PaddleOcrEngine:
    """PaddleOCR (detection + recognition), loaded once. Install with: pip install -e ".[ocr]".

    oneDNN is switched off: with PaddlePaddle 3.3 on Windows CPUs it fails on these models
    ("ConvertPirAttribute2RuntimeAttribute not support"); see docs/decisions.md D18.
    """

    def __init__(self) -> None:
        try:
            from paddleocr import PaddleOCR
        except ImportError as err:  # pragma: no cover - depends on the optional extra
            raise RuntimeError('PaddleOCR is not installed. Run: pip install -e ".[ocr]"') from err
        self._ocr = PaddleOCR(
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            enable_mkldnn=False,
            text_detection_model_name=DET_MODEL,
            text_recognition_model_name=REC_MODEL,
        )

    def read_lines(self, image: np.ndarray) -> list[Line]:  # pragma: no cover - needs the model
        lines: list[Line] = []
        for result in self._ocr.predict(image):
            texts = result.get("rec_texts", [])
            scores = result.get("rec_scores", [])
            polys = result.get("rec_polys", result.get("dt_polys", []))
            for i, (text, score) in enumerate(zip(texts, scores, strict=False)):
                if i < len(polys):
                    pts = np.asarray(polys[i], dtype=float)
                    top, left = float(pts[:, 1].min()), float(pts[:, 0].min())
                    height = float(pts[:, 1].max() - pts[:, 1].min()) or 1.0
                else:
                    top, left, height = float(i), 0.0, 1.0
                lines.append(Line(str(text), float(score), top, left, height))
        return lines


def read_plate(
    engine: OcrEngine, bgr: np.ndarray, box: Box, contrast: bool = False
) -> PlateText | None:
    """Crop, preprocess, OCR and combine. None if nothing readable."""
    region = crop(bgr, box)
    if region.size == 0:
        return None
    return combine(engine.read_lines(preprocess(region, contrast)))
