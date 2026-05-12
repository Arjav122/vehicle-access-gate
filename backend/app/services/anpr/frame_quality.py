"""Full-frame quality checks before YOLO/OCR (blur, under/over exposure)."""

from __future__ import annotations

import os

import numpy as np

# Tunable via environment without touching app config.
_BLUR_VAR_MIN = float(os.environ.get("ANPR_FRAME_BLUR_VAR_MIN", "90"))
_MEAN_DARK_MAX = float(os.environ.get("ANPR_FRAME_MEAN_DARK_MAX", "38"))
_MEAN_BRIGHT_MIN = float(os.environ.get("ANPR_FRAME_MEAN_BRIGHT_MIN", "218"))
_OVEREXPOSED_FRAC_MAX = float(os.environ.get("ANPR_FRAME_OVEREXPOSED_FRAC_MAX", "0.14"))


def assess_frame_quality(bgr: np.ndarray) -> tuple[bool, str | None]:
    """
    Return (ok, reason_if_not_ok).
    Uses Laplacian variance (blur), mean luminance (dark/bright), and highlight clipping.
    """
    import cv2

    if bgr is None or bgr.size == 0:
        return False, "empty_frame"

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    lap = cv2.Laplacian(gray, cv2.CV_64F)
    blur_var = float(lap.var())
    if blur_var < _BLUR_VAR_MIN:
        return False, "Please Rescan: image is too blurry (hold phone steady, move closer)."

    mean_lum = float(gray.mean())
    if mean_lum < _MEAN_DARK_MAX:
        return False, "Please Rescan: frame is too dark (add light or angle away from shadow)."

    if mean_lum > _MEAN_BRIGHT_MIN:
        return False, "Please Rescan: frame is overexposed (reduce glare on the plate)."

    over_frac = float((gray >= 250).sum()) / float(gray.size)
    if over_frac > _OVEREXPOSED_FRAC_MAX:
        return False, "Please Rescan: too many blown highlights (reduce glare or tilt slightly)."

    return True, None
