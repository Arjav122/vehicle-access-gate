"""ANPR entry point (delegates to ``app.services.anpr``)."""

from app.services.anpr import (
    VisionConsensusResult,
    VisionPlateResult,
    analyze_detection_scan,
    analyze_frames_consensus,
    analyze_image_bytes,
)

__all__ = [
    "VisionPlateResult",
    "VisionConsensusResult",
    "analyze_image_bytes",
    "analyze_frames_consensus",
    "analyze_detection_scan",
]
