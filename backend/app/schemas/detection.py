from pydantic import BaseModel, Field


class PlateProcessRequest(BaseModel):
    plate_text: str = Field(min_length=1, max_length=32)


class PlateDetectionResult(BaseModel):
    """Response from ``POST /api/v1/detection/analyze``."""

    plate_text: str | None = None
    confidence: float | None = Field(
        default=None,
        description="Best OCR confidence score (EasyOCR), if available.",
    )
    detection_confidence: float | None = Field(
        default=None,
        description="YOLO confidence for the best license-plate bounding box.",
    )
    plate_boxes_found: int = Field(
        default=0,
        ge=0,
        description="Number of plate regions returned by the ANPR detector.",
    )
    detail: str | None = Field(default=None, description="Diagnostics or error summary.")
    candidates: list[str] = Field(default_factory=list)
    ocr_preprocessing: str | None = Field(
        default=None,
        description="Short note on preprocessing applied before OCR.",
    )
    recommend_rescan: bool = Field(
        default=False,
        description="True when frame quality or OCR stability suggests rescanning.",
    )


class PlateConsensusFrameResult(BaseModel):
    plate_text: str | None = None
    confidence: float | None = None
    detection_confidence: float | None = None
    plate_boxes_found: int = 0


class PlateConsensusResult(BaseModel):
    plate_text: str | None = None
    confidence: float | None = None
    reliable: bool = False
    recommend_rescan: bool = True
    detail: str | None = None
    candidates: list[str] = Field(default_factory=list)
    frames_used: int = 0
    detections_found: int = 0
    frame_results: list[PlateConsensusFrameResult] = Field(default_factory=list)
