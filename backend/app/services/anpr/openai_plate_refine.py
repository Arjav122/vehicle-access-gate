"""Optional OpenAI vision refinement when OCR confidence is low (does not change auth rules)."""

from __future__ import annotations

import base64
import json
import logging
import os
import re

import numpy as np

from app.config import get_settings
from app.utils.plates import normalize_plate, refine_indian_plate_ocr

logger = logging.getLogger(__name__)

_INDIAN_NEW = re.compile(r"^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$")

# Refine only when OCR confidence below this (0–1 scale from Paddle/Easy).
_DEFAULT_REFINE_BELOW = float(os.environ.get("ANPR_OPENAI_REFINE_BELOW", "0.64"))
# Skip OpenAI when OCR already confident
_SKIP_IF_ABOVE = float(os.environ.get("ANPR_OPENAI_REFINE_SKIP_ABOVE", "0.78"))


def _jpeg_b64_from_bgr(bgr: np.ndarray, *, max_side: int = 512, quality: int = 88) -> str:
    import cv2

    h, w = bgr.shape[:2]
    if max(h, w) > max_side and max(h, w) > 0:
        scale = max_side / float(max(h, w))
        nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
        bgr = cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        return ""
    return base64.standard_b64encode(buf.tobytes()).decode("ascii")


def maybe_openai_refine_plate(
    crop_bgr: np.ndarray,
    *,
    best_plate: str,
    candidates: list[str],
    ocr_conf: float | None,
) -> str | None:
    """
    If OPENAI_API_KEY is set and read is uncertain, ask the model to pick among candidates
    or output one normalized plate string. Returns refined plate or None to keep ``best_plate``.
    """
    settings = get_settings()
    if not settings.openai_api_key.strip():
        return None
    if os.environ.get("ANPR_OPENAI_REFINE", "1").strip().lower() in ("0", "false", "no"):
        return None

    oc = float(ocr_conf or 0.0)
    if oc >= _SKIP_IF_ABOVE:
        return None
    refined_best = refine_indian_plate_ocr(best_plate)
    if oc >= _DEFAULT_REFINE_BELOW and _INDIAN_NEW.match(refined_best):
        return None

    cand_list = list(dict.fromkeys([normalize_plate(c) for c in ([best_plate] + candidates) if c]))[:8]
    cand_list = [c for c in cand_list if c]
    if not cand_list:
        return None

    b64 = _jpeg_b64_from_bgr(crop_bgr)
    if not b64:
        return None

    prompt = (
        "You are helping read an Indian vehicle license plate from the image. "
        "OCR produced uncertain text. Candidates (uppercase, no spaces): "
        + ", ".join(cand_list)
        + ". Reply with ONLY compact JSON: {\"plate\":\"AB12CD1234\"} using letters A-Z and digits 0-9 only, "
        "no spaces. If you cannot determine the plate, reply {\"plate\":null}. "
        "Prefer the candidate that visually matches the image; fix only clear OCR confusions."
    )

    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)
        resp = client.chat.completions.create(
            model=os.environ.get("ANPR_OPENAI_REFINE_MODEL", "gpt-4o-mini"),
            max_tokens=80,
            temperature=0.0,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                        },
                    ],
                }
            ],
        )
        raw = (resp.choices[0].message.content or "").strip()
    except Exception as e:  # noqa: BLE001
        logger.warning("OpenAI plate refine failed: %s", e)
        return None

    plate_out: str | None = None
    try:
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw).strip()
        data = json.loads(raw)
        p = data.get("plate")
        if isinstance(p, str) and p.strip():
            plate_out = normalize_plate(p)
    except (json.JSONDecodeError, TypeError, AttributeError):
        logger.debug("OpenAI refine JSON parse failed, raw=%s", raw[:200])

    if not plate_out:
        return None
    if plate_out == normalize_plate(best_plate) or plate_out == refine_indian_plate_ocr(best_plate):
        return None
    return refine_indian_plate_ocr(plate_out)
