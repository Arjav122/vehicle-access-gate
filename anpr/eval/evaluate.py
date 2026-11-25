"""Measure the worker on a labelled photo set (see DATASET.md) and write result tables.

    python eval/evaluate.py --data eval/data/<set-name> [--name <label>] [--ocr-contrast]

Reports only what it measured:
  - detection: share of photos with a plate found; AP@0.5 when YOLO box labels exist
  - OCR exact-plate accuracy, single frame (raw worker output, before server repair)
  - CPU latency of the detector (ONNX FP32) and OCR per crop: median and p95
Writes eval/results/<name>.md and <name>.json. Nothing is estimated or extrapolated.
Frame voting and "with server repair" need video clips and are not measured here yet.
"""

from __future__ import annotations

import argparse
import csv
import json
import platform
import re
import statistics
import sys
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from anpr.config import load_settings  # noqa: E402
from anpr.detector import Box, PlateDetector  # noqa: E402
from anpr.ocr import read_plate  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"


def clean(plate: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", plate.upper())


def load_labels(folder: Path) -> list[tuple[Path, str]]:
    with (folder / "labels.csv").open(encoding="utf-8") as f:
        return [(folder / row["filename"], clean(row["plate"])) for row in csv.DictReader(f)]


def yolo_boxes(path: Path, width: int, height: int) -> list[tuple[float, float, float, float]]:
    """Ground-truth boxes from a YOLO .txt (class cx cy w h, relative) in pixels."""
    out = []
    for line in path.read_text().split("\n"):
        parts = line.split()
        if len(parts) == 5:
            _, cx, cy, w, h = map(float, parts)
            out.append(
                (
                    (cx - w / 2) * width,
                    (cy - h / 2) * height,
                    (cx + w / 2) * width,
                    (cy + h / 2) * height,
                )
            )
    return out


def iou(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def average_precision(preds: list[tuple[float, bool]], n_truth: int) -> float:
    """VOC-style AP from (score, is_true_positive) pairs over the whole set."""
    if n_truth == 0:
        return 0.0
    tp = fp = 0
    points = []
    for _, ok in sorted(preds, key=lambda p: -p[0]):
        tp += ok
        fp += not ok
        points.append((tp / n_truth, tp / (tp + fp)))
    ap, prev_recall = 0.0, 0.0
    for i, (recall, _) in enumerate(points):
        precision = max(p for _, p in points[i:])
        ap += (recall - prev_recall) * precision
        prev_recall = recall
    return ap


@dataclass
class Report:
    name: str
    images: int
    plates_found_share: float
    ap50: float | None
    ocr_exact: int
    ocr_exact_share: float
    detector_ms_median: float
    detector_ms_p95: float
    ocr_ms_median: float | None
    ocr_ms_p95: float | None
    machine: str
    measured_at: str


def p95(values: list[float]) -> float:
    return float(np.percentile(values, 95)) if values else 0.0


def evaluate(folder: Path, name: str, contrast: bool) -> Report:
    from anpr.ocr import PaddleOcrEngine

    settings = load_settings()
    detector = PlateDetector(
        settings.detector_model, settings.detector_input_size, settings.detector_confidence
    )
    ocr = PaddleOcrEngine()
    labels = load_labels(folder)

    det_ms: list[float] = []
    ocr_ms: list[float] = []
    found = exact = 0
    preds: list[tuple[float, bool]] = []
    n_truth = 0
    has_boxes = (folder / "boxes").is_dir()

    for path, truth in labels:
        image = cv2.imread(str(path))
        if image is None:
            raise FileNotFoundError(path)
        t = time.perf_counter()
        boxes: list[Box] = detector.detect(image)
        det_ms.append((time.perf_counter() - t) * 1000)
        found += bool(boxes)

        if has_boxes:
            truth_boxes = yolo_boxes(
                folder / "boxes" / f"{path.stem}.txt", image.shape[1], image.shape[0]
            )
            n_truth += len(truth_boxes)
            matched: set[int] = set()
            for b in boxes:
                ious = [iou((b.x1, b.y1, b.x2, b.y2), tb) for tb in truth_boxes]
                best = int(np.argmax(ious)) if ious else -1
                ok = best >= 0 and ious[best] >= 0.5 and best not in matched
                if ok:
                    matched.add(best)
                preds.append((b.score, ok))

        if boxes:
            t = time.perf_counter()
            text = read_plate(ocr, image, boxes[0], contrast)
            ocr_ms.append((time.perf_counter() - t) * 1000)
            exact += bool(text and text.text == truth)

    n = len(labels)
    return Report(
        name=name,
        images=n,
        plates_found_share=round(found / n, 4) if n else 0.0,
        ap50=round(average_precision(preds, n_truth), 4) if has_boxes else None,
        ocr_exact=exact,
        ocr_exact_share=round(exact / n, 4) if n else 0.0,
        detector_ms_median=round(statistics.median(det_ms), 1) if det_ms else 0.0,
        detector_ms_p95=round(p95(det_ms), 1),
        ocr_ms_median=round(statistics.median(ocr_ms), 1) if ocr_ms else None,
        ocr_ms_p95=round(p95(ocr_ms), 1) if ocr_ms else None,
        machine=" · ".join(
            [
                platform.processor() or platform.machine(),
                f"{platform.system()} {platform.release()}",
            ]
        ),
        measured_at=datetime.now(UTC).isoformat(timespec="seconds"),
    )


def to_markdown(r: Report) -> str:
    ap = f"{r.ap50:.3f}" if r.ap50 is not None else "not measured (no box labels)"
    ocr_lat = f"{r.ocr_ms_median} / {r.ocr_ms_p95}" if r.ocr_ms_median is not None else "n/a"
    exact = f"{r.ocr_exact} / {r.images} ({r.ocr_exact_share:.1%})"
    det_lat = f"{r.detector_ms_median} / {r.detector_ms_p95}"
    return "\n".join(
        [
            f"# Evaluation: {r.name}",
            "",
            f"Measured {r.measured_at} on {r.machine}, {r.images} labelled photos.",
            "",
            "| Metric | Value |",
            "|---|---|",
            f"| Photos with a plate found | {r.plates_found_share:.1%} |",
            f"| Detection AP@0.5 | {ap} |",
            f"| OCR exact plate, single frame, before server repair | {exact} |",
            f"| Detector latency, ONNX FP32 CPU (median / p95 ms) | {det_lat} |",
            f"| OCR latency per crop (median / p95 ms) | {ocr_lat} |",
            "| Frame voting, with server repair | not measured (needs video clips) |",
            "",
        ]
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Evaluate the ANPR worker on a labelled photo set.")
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--name", default=None)
    p.add_argument("--ocr-contrast", action="store_true")
    args = p.parse_args(argv)
    name = args.name or args.data.name
    report = evaluate(args.data, name, args.ocr_contrast)
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"{name}.json").write_text(
        json.dumps(asdict(report), indent=2) + "\n", encoding="utf-8"
    )
    (RESULTS / f"{name}.md").write_text(to_markdown(report), encoding="utf-8")
    print(to_markdown(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
