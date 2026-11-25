"""Plate detector: a YOLO11 model on ONNX Runtime, with letterboxing, decoding and NMS in NumPy.

No PyTorch or Ultralytics at run time (brief §11.2): smaller install, and no AGPL code here.
The model takes a 640×640 RGB image scaled to 0–1 and returns (1, 5, N): for each of N anchor
points, the box centre x, centre y, width, height and the plate score.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass(frozen=True)
class Box:
    """A plate box in original image pixels."""

    x1: float
    y1: float
    x2: float
    y2: float
    score: float


@dataclass(frozen=True)
class Letterbox:
    """How an image was resized and padded, so boxes can be mapped back."""

    scale: float
    pad_x: float
    pad_y: float


def letterbox(image: np.ndarray, size: int) -> tuple[np.ndarray, Letterbox]:
    """Resize keeping the aspect ratio, then pad to size×size with grey (114), centred."""
    h, w = image.shape[:2]
    scale = min(size / h, size / w)
    new_w, new_h = round(w * scale), round(h * scale)
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    pad_x, pad_y = (size - new_w) / 2, (size - new_h) / 2
    top, left = round(pad_y - 0.1), round(pad_x - 0.1)
    out = np.full((size, size, 3), 114, dtype=np.uint8)
    out[top : top + new_h, left : left + new_w] = resized
    return out, Letterbox(scale=scale, pad_x=left, pad_y=top)


def decode(output: np.ndarray, conf_threshold: float) -> tuple[np.ndarray, np.ndarray]:
    """(1, 5, N) → boxes (M, 4) as x1, y1, x2, y2 in model pixels + scores (M,) above threshold."""
    preds = output[0].T  # (N, 5): cx, cy, w, h, score
    scores = preds[:, 4]
    keep = scores >= conf_threshold
    preds, scores = preds[keep], scores[keep]
    cx, cy, w, h = preds[:, 0], preds[:, 1], preds[:, 2], preds[:, 3]
    boxes = np.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], axis=1)
    return boxes, scores


def iou(box: np.ndarray, others: np.ndarray) -> np.ndarray:
    """Intersection over union of one box (4,) with many (M, 4)."""
    x1 = np.maximum(box[0], others[:, 0])
    y1 = np.maximum(box[1], others[:, 1])
    x2 = np.minimum(box[2], others[:, 2])
    y2 = np.minimum(box[3], others[:, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area = (box[2] - box[0]) * (box[3] - box[1])
    areas = (others[:, 2] - others[:, 0]) * (others[:, 3] - others[:, 1])
    return inter / np.maximum(area + areas - inter, 1e-9)


def nms(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float) -> list[int]:
    """Non-maximum suppression: keep the best box, drop boxes overlapping it, repeat."""
    order = np.argsort(-scores)
    keep: list[int] = []
    while order.size:
        best = int(order[0])
        keep.append(best)
        rest = order[1:]
        order = rest[iou(boxes[best], boxes[rest]) <= iou_threshold]
    return keep


def to_original(boxes: np.ndarray, lb: Letterbox, width: int, height: int) -> np.ndarray:
    """Undo letterboxing and clip to the image."""
    out = boxes.copy()
    out[:, [0, 2]] = (out[:, [0, 2]] - lb.pad_x) / lb.scale
    out[:, [1, 3]] = (out[:, [1, 3]] - lb.pad_y) / lb.scale
    out[:, [0, 2]] = out[:, [0, 2]].clip(0, width)
    out[:, [1, 3]] = out[:, [1, 3]].clip(0, height)
    return out


class PlateDetector:
    """Loads the model once; `detect(bgr)` returns plate boxes, best first."""

    def __init__(
        self, model_path: Path, input_size: int = 640, confidence: float = 0.35, iou: float = 0.5
    ):
        import onnxruntime as ort

        if not Path(model_path).exists():
            raise FileNotFoundError(f"{model_path} not found. Run: python -m anpr.download_model")
        self.session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.size = input_size
        self.confidence = confidence
        self.iou = iou

    def detect(self, bgr: np.ndarray) -> list[Box]:
        h, w = bgr.shape[:2]
        padded, lb = letterbox(bgr, self.size)
        blob = (
            cv2.cvtColor(padded, cv2.COLOR_BGR2RGB).astype(np.float32).transpose(2, 0, 1)[None]
            / 255.0
        )
        (output,) = self.session.run(None, {self.input_name: blob})
        boxes, scores = decode(output, self.confidence)
        if not len(scores):
            return []
        keep = nms(boxes, scores, self.iou)
        mapped = to_original(boxes[keep], lb, w, h)
        return [
            Box(*map(float, b), score=float(s)) for b, s in zip(mapped, scores[keep], strict=True)
        ]
