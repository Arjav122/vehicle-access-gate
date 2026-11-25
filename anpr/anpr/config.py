"""Worker settings from environment variables (prefix ANPR_) or anpr/.env (brief §16)."""

from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ANPR_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ANPR_",
        env_file=ANPR_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Server and camera identity (keys come from `npm run webcam:devices` or an admin).
    api_url: str = "http://127.0.0.1:4000"
    device_key: str = ""
    exit_device_key: str = ""
    web_url: str = Field(
        "http://127.0.0.1:5173", description="Web app, for 'Register this visitor'"
    )

    # Detector
    detector_model: Path = ANPR_ROOT / "models" / "plate-detector.onnx"
    detector_input_size: int = 640
    detector_confidence: float = 0.35
    detector_iou: float = 0.5

    # Frame voting
    sample_fps: float = 5.0
    track_gap_seconds: float = 2.0
    track_min_agreeing_reads: int = 3

    # Delivery
    max_retries: int = 4
    buffer_path: Path = ANPR_ROOT / "data" / "buffer.sqlite"

    # Camera and preview
    camera_width: int = 1280
    camera_height: int = 720
    preview_port: int = 8765
    ocr_contrast: bool = False


def load_settings() -> Settings:
    return Settings()
