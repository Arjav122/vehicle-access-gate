"""Shared test helpers: synthetic plate scenes, a stand-in OCR, a stand-in detector."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from anpr.config import ANPR_ROOT
from anpr.detector import Box
from anpr.ocr import Line

MODEL = ANPR_ROOT / "models" / "plate-detector.onnx"
needs_model = pytest.mark.skipif(
    not MODEL.exists(), reason="run `python -m anpr.download_model` first"
)

PLATE_BOX = (440, 470, 840, 550)  # where scene() draws the plate


def scene(text: str = "UP16 AB 1234", width: int = 1280, height: int = 720) -> np.ndarray:
    """A grey background, a 'car', and a white HSRP-style plate with a blue IND strip."""
    img = np.full((height, width, 3), 90, np.uint8)
    cv2.rectangle(img, (300, 200), (980, 620), (40, 40, 160), -1)
    x1, y1, x2, y2 = PLATE_BOX
    cv2.rectangle(img, (x1, y1), (x2, y2), (255, 255, 255), -1)
    cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 0), 3)
    cv2.rectangle(img, (x1 + 3, y1 + 3), (x1 + 28, y2 - 3), (180, 80, 30), -1)
    cv2.putText(img, text, (x1 + 38, y1 + 55), cv2.FONT_HERSHEY_DUPLEX, 1.25, (0, 0, 0), 3)
    return img


class ScriptedOcr:
    """Stand-in OCR: returns the next scripted reading for each crop it is shown."""

    def __init__(self, readings: list[list[tuple[str, float]]]):
        self.readings = list(readings)
        self.calls = 0

    def read_lines(self, image: np.ndarray) -> list[Line]:
        self.calls += 1
        lines = self.readings.pop(0) if self.readings else []
        # Each scripted piece is its own row (top to bottom), like a two-line plate.
        return [Line(t, c, top=i * 40.0, left=0.0, height=30.0) for i, (t, c) in enumerate(lines)]


class FixedDetector:
    """Stand-in detector: always finds the same plate box (or none)."""

    def __init__(self, found: bool = True):
        self.found = found

    def detect(self, bgr: np.ndarray) -> list[Box]:
        return [Box(*map(float, PLATE_BOX), score=0.9)] if self.found else []


@pytest.fixture
def tmp_images(tmp_path: Path) -> Path:
    folder = tmp_path / "photos"
    folder.mkdir()
    return folder
