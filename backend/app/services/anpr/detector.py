"""License-plate detection using a YOLO11 ANPR checkpoint (not COCO generic YOLO)."""

from __future__ import annotations

import logging
import os
import numpy as np

logger = logging.getLogger(__name__)

# Hugging Face: YOLO11 fine-tuned on license plates (Roboflow-style ANPR dataset).
DEFAULT_PLATE_REPO = os.environ.get(
    "PLATE_DETECTOR_REPO", "DavidDrill69/yolov11-license-plate-detection"
)
DEFAULT_PLATE_FILE = os.environ.get(
    "PLATE_DETECTOR_WEIGHTS", "license-plate-finetune-v1n.pt"
)

_plate_model = None


def _get_plate_yolo():
    global _plate_model
    if _plate_model is not None:
        return _plate_model
    try:
        from huggingface_hub import hf_hub_download
        from ultralytics import YOLO
    except ImportError as e:
        raise RuntimeError(
            "ultralytics and huggingface_hub are required for plate detection. "
            f"Install backend deps: {e}"
        ) from e

    path = hf_hub_download(
        repo_id=DEFAULT_PLATE_REPO,
        filename=DEFAULT_PLATE_FILE,
        cache_dir=os.environ.get("HF_HUB_CACHE"),
    )
    _plate_model = YOLO(path)
    logger.info("Loaded ANPR detector from %s/%s", DEFAULT_PLATE_REPO, DEFAULT_PLATE_FILE)
    return _plate_model


def detect_plate_regions(
    bgr: np.ndarray,
    *,
    conf_threshold: float | None = None,
    margin_ratio: float = 0.12,
) -> list[tuple[np.ndarray, float, tuple[int, int, int, int]]]:
    """
    Run plate-specific YOLO on BGR image.

    Returns list of (crop_bgr, box_confidence, (x1, y1, x2, y2)) sorted by confidence desc.
    """
    if conf_threshold is None:
        conf_threshold = float(os.environ.get("PLATE_DETECTION_CONF", "0.25"))
    model = _get_plate_yolo()
    h, w = bgr.shape[:2]
    res = model.predict(
        source=bgr,
        imgsz=640,
        conf=conf_threshold,
        verbose=False,
    )
    if not res or res[0].boxes is None or len(res[0].boxes) == 0:
        return []

    boxes = res[0].boxes.xyxy.cpu().numpy()
    scores = res[0].boxes.conf.cpu().numpy()
    out: list[tuple[np.ndarray, float, tuple[int, int, int, int]]] = []
    for xyxy, sc in zip(boxes, scores, strict=False):
        x1, y1, x2, y2 = [int(round(v)) for v in xyxy]
        bw, bh = max(1, x2 - x1), max(1, y2 - y1)
        min_short = int(os.environ.get("ANPR_MIN_PLATE_SHORT_SIDE", "28"))
        if min(bw, bh) < min_short:
            continue
        mx = int(bw * margin_ratio)
        my = int(bh * margin_ratio)
        x1e = max(0, x1 - mx)
        y1e = max(0, y1 - my)
        x2e = min(w, x2 + mx)
        y2e = min(h, y2 + my)
        crop = bgr[y1e:y2e, x1e:x2e].copy()
        if crop.size == 0:
            continue
        out.append((crop, float(sc), (x1e, y1e, x2e, y2e)))

    out.sort(key=lambda t: t[1], reverse=True)
    return out
