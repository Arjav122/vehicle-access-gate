"""ANPR: Hugging Face YOLO11 license-plate detector + EasyOCR."""

from app.services.anpr.pipeline import analyze_detection_scan, analyze_frames_consensus, analyze_image_bytes
from app.services.anpr.types import VisionConsensusResult, VisionPlateResult

__all__ = [
    "VisionPlateResult",
    "VisionConsensusResult",
    "analyze_image_bytes",
    "analyze_frames_consensus",
    "analyze_detection_scan",
]
