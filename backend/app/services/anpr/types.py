from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class VisionPlateResult:
    """Structured output from the ANPR pipeline (detector + OCR)."""

    plate_text: str | None
    confidence: float | None  # best OCR confidence when available
    candidates: list[str] = field(default_factory=list)
    detail: str | None = None
    detection_confidence: float | None = None  # best YOLO box score
    plate_boxes_found: int = 0
    ocr_preprocessing: str | None = None
    recommend_rescan: bool = False


@dataclass
class VisionConsensusResult:
    plate_text: str | None
    confidence: float | None
    reliable: bool
    recommend_rescan: bool
    detail: str | None = None
    candidates: list[str] = field(default_factory=list)
    frames_used: int = 0
    detections_found: int = 0
    frame_results: list[VisionPlateResult] = field(default_factory=list)
