"""End-to-end ANPR: YOLO11 plate detector (HF) + PaddleOCR / EasyOCR + optional OpenAI refine."""

from __future__ import annotations

import logging
import os
from collections import defaultdict

import numpy as np

from app.services.anpr.detector import detect_plate_regions
from app.services.anpr.frame_quality import assess_frame_quality
from app.services.anpr.ocr_engine import preprocess_for_ocr, read_plate_from_crops, read_texts_from_gray
from app.services.anpr.openai_plate_refine import maybe_openai_refine_plate
from app.services.anpr.types import VisionConsensusResult, VisionPlateResult
from app.utils.plates import normalize_plate, refine_indian_plate_ocr

logger = logging.getLogger(__name__)

_EARLY_AGREE_OCR_MIN = float(os.environ.get("ANPR_EARLY_AGREE_OCR_MIN", "0.38"))
_FAST_CONSENSUS_MIN_CONF = float(os.environ.get("ANPR_FAST_CONSENSUS_MIN_CONF", "0.42"))


def _ocr_fallback_roi(bgr: np.ndarray) -> VisionPlateResult:
    """If detector finds nothing, OCR a lower-center ROI (dashcam-style framing)."""
    h, w = bgr.shape[:2]
    roi = bgr[max(0, h // 5) : h, max(0, w // 10) : w - w // 10]
    proc, note = preprocess_for_ocr(roi)
    try:
        texts = read_texts_from_gray(proc)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Fallback OCR failed: %s", exc)
        return VisionPlateResult(
            None,
            None,
            [],
            str(exc),
            detection_confidence=None,
            plate_boxes_found=0,
            ocr_preprocessing=note,
            recommend_rescan=True,
        )

    candidates: list[str] = []
    best: tuple[str, float] | None = None
    for raw, conf in texts:
        norm = normalize_plate(raw)
        if not norm:
            continue
        refined = refine_indian_plate_ocr(norm)
        candidates.append(refined)
        if best is None or conf > best[1]:
            best = (refined, float(conf))

    if best:
        # Dedupe candidates while preserving order
        seen: set[str] = set()
        uniq: list[str] = []
        for c in candidates:
            if c not in seen:
                seen.add(c)
                uniq.append(c)
        plate_final, conf_final = best[0], best[1]
        refined = maybe_openai_refine_plate(
            roi,
            best_plate=plate_final,
            candidates=uniq,
            ocr_conf=conf_final,
        )
        if refined:
            uniq2 = list(dict.fromkeys([refined] + uniq))
            return VisionPlateResult(
                refined,
                conf_final,
                uniq2,
                "fallback_roi_no_detector_boxes+openai_refine",
                detection_confidence=None,
                plate_boxes_found=0,
                ocr_preprocessing=note,
                recommend_rescan=float(conf_final) < _FAST_CONSENSUS_MIN_CONF,
            )
        return VisionPlateResult(
            plate_final,
            conf_final,
            uniq,
            "fallback_roi_no_detector_boxes",
            detection_confidence=None,
            plate_boxes_found=0,
            ocr_preprocessing=note,
            recommend_rescan=float(conf_final) < _FAST_CONSENSUS_MIN_CONF,
        )
    return VisionPlateResult(
        None,
        None,
        list(dict.fromkeys(candidates)),
        "No plate regions and no OCR text in ROI",
        detection_confidence=None,
        plate_boxes_found=0,
        ocr_preprocessing=note,
        recommend_rescan=True,
    )


def _analyze_bgr(frame: np.ndarray) -> VisionPlateResult:
    """Run detector + OCR on one BGR frame (no full-frame quality gate)."""
    try:
        regions = detect_plate_regions(frame)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Plate detector failed: %s", exc)
        return VisionPlateResult(
            None,
            None,
            [],
            f"Detector error: {exc}",
            plate_boxes_found=0,
            recommend_rescan=True,
        )

    if not regions:
        return _ocr_fallback_roi(frame)

    crops_conf = [(crop, sc) for crop, sc, _ in regions]
    plate_text, ocr_conf, candidates, note = read_plate_from_crops(crops_conf)
    best_det = regions[0][1] if regions else None

    if not plate_text:
        fb = _ocr_fallback_roi(frame)
        if fb.plate_text:
            fb.detail = (fb.detail or "") + "; detector_boxes_present_but_OCR_empty"
            fb.plate_boxes_found = len(regions)
            fb.detection_confidence = best_det
            return fb
        return VisionPlateResult(
            None,
            None,
            candidates,
            "Detector found regions but OCR returned no text",
            detection_confidence=best_det,
            plate_boxes_found=len(regions),
            ocr_preprocessing=note,
            recommend_rescan=True,
        )

    best_crop_bgr = regions[0][0]
    refined = maybe_openai_refine_plate(
        best_crop_bgr,
        best_plate=plate_text,
        candidates=list(candidates),
        ocr_conf=float(ocr_conf) if ocr_conf is not None else None,
    )
    plate_out = refined or plate_text
    candidates_out = (
        list(dict.fromkeys([refined] + list(candidates))) if refined else list(candidates)
    )

    low_conf = ocr_conf is not None and float(ocr_conf) < _FAST_CONSENSUS_MIN_CONF
    return VisionPlateResult(
        plate_out,
        ocr_conf,
        candidates_out,
        "openai_refined" if refined else None,
        detection_confidence=best_det,
        plate_boxes_found=len(regions),
        ocr_preprocessing=note,
        recommend_rescan=low_conf,
    )


def analyze_image_bytes(image_bytes: bytes) -> VisionPlateResult:
    """Decode JPEG/PNG, reject poor full-frame quality, then run ANPR."""
    try:
        import cv2
    except ImportError as e:
        return VisionPlateResult(
            None,
            None,
            [],
            f"OpenCV missing: {e}",
            plate_boxes_found=0,
            recommend_rescan=True,
        )

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        return VisionPlateResult(
            None,
            None,
            [],
            "Invalid image",
            plate_boxes_found=0,
            recommend_rescan=True,
        )

    ok, reason = assess_frame_quality(frame)
    if not ok:
        return VisionPlateResult(
            None,
            None,
            [],
            reason,
            detection_confidence=None,
            plate_boxes_found=0,
            ocr_preprocessing="quality_gate_rejected",
            recommend_rescan=True,
        )

    return _analyze_bgr(frame)


def _aggregate_multi_frame_results(
    results: list[VisionPlateResult],
    *,
    min_confidence: float,
) -> VisionPlateResult:
    score_map: dict[str, float] = defaultdict(float)
    max_conf_map: dict[str, float] = defaultdict(float)
    count_map: dict[str, int] = defaultdict(int)
    cand_accum: list[str] = []
    max_boxes = 0
    best_preproc: str | None = None
    best_det: float | None = None

    n_with_plate = sum(1 for r in results if r.plate_text)

    for r in results:
        if not r.plate_text:
            continue
        plate = normalize_plate(r.plate_text)
        if not plate:
            continue
        ocr_c = float(r.confidence or 0.0)
        det_c = float(r.detection_confidence or 0.0)
        score_map[plate] += 1.0 + (ocr_c * 0.65) + (det_c * 0.25)
        max_conf_map[plate] = max(max_conf_map[plate], ocr_c)
        count_map[plate] += 1
        cand_accum.extend(r.candidates or [])
        max_boxes = max(max_boxes, r.plate_boxes_found)
        if r.ocr_preprocessing:
            best_preproc = r.ocr_preprocessing
        if r.detection_confidence is not None:
            best_det = max(best_det or 0.0, float(r.detection_confidence))

    if not score_map:
        return VisionPlateResult(
            None,
            None,
            [],
            "Please Rescan: no readable plate in captured frames.",
            detection_confidence=best_det,
            plate_boxes_found=max_boxes,
            ocr_preprocessing=best_preproc,
            recommend_rescan=True,
        )

    best_plate = max(score_map.keys(), key=lambda p: score_map[p])
    best_conf = max_conf_map[best_plate]
    repeat_ratio = count_map[best_plate] / max(1, n_with_plate)
    recommend_rescan = bool(best_conf < min_confidence or repeat_ratio < 0.5)
    detail = None
    if recommend_rescan:
        detail = (
            f"Please Rescan: unstable read ({count_map[best_plate]}/{n_with_plate} frames matched, "
            f"confidence {best_conf:.2f})."
        )

    merged_cands = list(dict.fromkeys([best_plate] + cand_accum))[:20]
    return VisionPlateResult(
        best_plate,
        best_conf,
        merged_cands,
        detail,
        detection_confidence=best_det,
        plate_boxes_found=max_boxes,
        ocr_preprocessing=best_preproc,
        recommend_rescan=recommend_rescan,
    )


def analyze_detection_scan(
    raw_frames: list[bytes],
    *,
    min_confidence: float | None = None,
) -> VisionPlateResult:
    """
    Gate scan entry: up to 3 JPEGs, per-frame quality gate, fast multi-frame consensus.

    Keeps same downstream plate string semantics as ``analyze_image_bytes`` for one frame.
    """
    if min_confidence is None:
        min_confidence = _FAST_CONSENSUS_MIN_CONF

    try:
        import cv2
    except ImportError as e:
        return VisionPlateResult(
            None,
            None,
            [],
            f"OpenCV missing: {e}",
            plate_boxes_found=0,
            recommend_rescan=True,
        )

    frames = [f for f in raw_frames if f][:3]
    if not frames:
        return VisionPlateResult(
            None,
            None,
            [],
            "No image data. Please Rescan.",
            plate_boxes_found=0,
            recommend_rescan=True,
        )

    good_bgr: list[np.ndarray] = []
    reject_notes: list[str] = []

    for raw in frames:
        arr = np.frombuffer(raw, dtype=np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if bgr is None:
            reject_notes.append("invalid_image")
            continue
        ok, reason = assess_frame_quality(bgr)
        if ok:
            good_bgr.append(bgr)
        else:
            reject_notes.append(reason or "quality_rejected")

    if not good_bgr:
        msg = reject_notes[0] if reject_notes else "Please Rescan: frame quality too low."
        if len(set(reject_notes)) > 1:
            msg = "Please Rescan: frames too blurry, dark, or overexposed."
        return VisionPlateResult(
            None,
            None,
            [],
            msg,
            detection_confidence=None,
            plate_boxes_found=0,
            ocr_preprocessing="all_frames_failed_quality_gate",
            recommend_rescan=True,
        )

    if len(good_bgr) == 1:
        out = _analyze_bgr(good_bgr[0])
        if out.confidence is not None and float(out.confidence) < min_confidence:
            out.recommend_rescan = True
            if not out.detail:
                out.detail = "Please Rescan: low OCR confidence on single frame."
        return out

    results: list[VisionPlateResult] = []
    for bgr in good_bgr:
        r = _analyze_bgr(bgr)
        results.append(r)
        if len(results) >= 2:
            a, b = results[-2], results[-1]
            pa = normalize_plate(a.plate_text or "")
            pb = normalize_plate(b.plate_text or "")
            if pa and pa == pb:
                ca, cb = float(a.confidence or 0.0), float(b.confidence or 0.0)
                if min(ca, cb) >= _EARLY_AGREE_OCR_MIN:
                    pick = a if ca >= cb else b
                    merged = list(dict.fromkeys((a.candidates or []) + (b.candidates or [])))[:20]
                    unstable = min(ca, cb) < min_confidence
                    return VisionPlateResult(
                        pick.plate_text,
                        max(ca, cb),
                        merged,
                        None if not unstable else "Please Rescan: borderline OCR agreement between frames.",
                        pick.detection_confidence,
                        max(a.plate_boxes_found, b.plate_boxes_found),
                        pick.ocr_preprocessing,
                        recommend_rescan=unstable,
                    )

    return _aggregate_multi_frame_results(results, min_confidence=min_confidence)


def analyze_frames_consensus(
    frames: list[bytes],
    *,
    min_confidence: float | None = None,
) -> VisionConsensusResult:
    """Run ANPR on multiple frames and return a consensus plate decision."""
    if min_confidence is None:
        min_confidence = float(os.environ.get("ANPR_MIN_CONFIDENCE", "0.55"))
    frames = [f for f in frames if f]
    if not frames:
        return VisionConsensusResult(
            plate_text=None,
            confidence=None,
            reliable=False,
            recommend_rescan=True,
            detail="No frames captured for consensus scan.",
        )

    frame_results = [analyze_image_bytes(f) for f in frames]
    detections_found = sum(1 for r in frame_results if r.plate_text)
    if detections_found == 0:
        return VisionConsensusResult(
            plate_text=None,
            confidence=None,
            reliable=False,
            recommend_rescan=True,
            detail="No readable plate in captured frames. Please rescan.",
            frames_used=len(frames),
            detections_found=0,
            frame_results=frame_results,
        )

    score_map: dict[str, float] = defaultdict(float)
    max_conf_map: dict[str, float] = defaultdict(float)
    count_map: dict[str, int] = defaultdict(int)
    for r in frame_results:
        if not r.plate_text:
            continue
        plate = normalize_plate(r.plate_text)
        if not plate:
            continue
        ocr_c = float(r.confidence or 0.0)
        det_c = float(r.detection_confidence or 0.0)
        score_map[plate] += 1.0 + (ocr_c * 0.7) + (det_c * 0.3)
        max_conf_map[plate] = max(max_conf_map[plate], ocr_c)
        count_map[plate] += 1

    if not score_map:
        return VisionConsensusResult(
            plate_text=None,
            confidence=None,
            reliable=False,
            recommend_rescan=True,
            detail="OCR reads were too noisy. Please rescan.",
            frames_used=len(frames),
            detections_found=detections_found,
            frame_results=frame_results,
        )

    ordered = sorted(score_map.keys(), key=lambda p: score_map[p], reverse=True)
    best = ordered[0]
    best_conf = max_conf_map[best]
    best_count = count_map[best]
    repeat_ratio = best_count / max(1, detections_found)

    reliable = bool(best_conf >= min_confidence and repeat_ratio >= 0.5)
    detail = None
    if not reliable:
        detail = (
            f"Low confidence consensus ({best_conf:.2f}) or unstable read "
            f"({best_count}/{detections_found} matching frames). Please rescan."
        )

    return VisionConsensusResult(
        plate_text=best,
        confidence=best_conf,
        reliable=reliable,
        recommend_rescan=not reliable,
        detail=detail,
        candidates=ordered,
        frames_used=len(frames),
        detections_found=detections_found,
        frame_results=frame_results,
    )
