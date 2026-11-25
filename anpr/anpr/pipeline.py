"""Frame → plates → OCR → voting → delivery. Shared by the CLI and the webcam preview page,
so both behave identically (this file is the one addition to the brief's layout).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

import cv2
import numpy as np

from anpr.buffer import OfflineBuffer
from anpr.client import GateClient, Outbound
from anpr.detector import Box
from anpr.ocr import OcrEngine, PlateText, read_plate
from anpr.sources import Frame
from anpr.tracker import PlateTracker, Read

SNAPSHOT_QUALITY = 85


class Detector(Protocol):
    def detect(self, bgr: np.ndarray) -> list[Box]: ...


@dataclass
class Delivery:
    """What happened to one voted read."""

    read: Read
    direction: str
    answer: dict[str, Any] | None = None  # the server's {status, event}, if it got through
    queued: bool = False  # kept in the offline buffer for later
    rejected: str | None = None  # a permanent 4xx from the server


@dataclass
class FrameResult:
    boxes: list[Box] = field(default_factory=list)
    texts: list[PlateText | None] = field(default_factory=list)
    deliveries: list[Delivery] = field(default_factory=list)


def encode_jpeg(image: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, SNAPSHOT_QUALITY])
    return buf.tobytes() if ok else b""


class Courier:
    """Delivers reads for one lane: write to the offline buffer, then drain it (old reads first)."""

    def __init__(self, client: GateClient, buffer: OfflineBuffer, direction: str):
        self.client = client
        self.buffer = buffer
        self.direction = direction

    def __call__(self, read: Read) -> Delivery:
        out = Outbound(read.text, read.confidence, read.at, self.direction, read.snapshot)
        row_id = self.buffer.add(out)
        result = self.buffer.drain(self.client)
        delivery = Delivery(read=read, direction=self.direction)
        for sent_id, answer in result.sent:
            if sent_id == row_id:
                delivery.answer = answer
        for rejected_id, err in result.rejected:
            if rejected_id == row_id:
                delivery.rejected = str(err)
        delivery.queued = delivery.answer is None and delivery.rejected is None
        return delivery


def dry_run(direction: str) -> Callable[[Read], Delivery]:
    """Deliver nowhere: just report what would have been sent."""
    return lambda read: Delivery(read=read, direction=direction)


class Pipeline:
    def __init__(
        self,
        detector: Detector,
        ocr: OcrEngine,
        deliver: Callable[[Read], Delivery],
        tracker: PlateTracker | None = None,
        contrast: bool = False,
    ):
        self.detector = detector
        self.ocr = ocr
        self.deliver = deliver
        self.tracker = tracker or PlateTracker()
        self.contrast = contrast

    def process(self, frame: Frame) -> FrameResult:
        result = FrameResult(boxes=self.detector.detect(frame.image))
        ready: list[Read] = []
        snapshot: bytes | None = None
        for box in result.boxes:
            text = read_plate(self.ocr, frame.image, box, self.contrast)
            result.texts.append(text)
            if text is None:
                continue
            snapshot = snapshot or encode_jpeg(frame.image)
            ready += self.tracker.add(
                Read(text=text.text, confidence=text.confidence, at=frame.at, snapshot=snapshot)
            )
        ready += self.tracker.expire(frame.at)
        if frame.still:
            ready += self.tracker.flush()
        result.deliveries = [self.deliver(r) for r in ready]
        return result

    def finish(self) -> list[Delivery]:
        """End of stream: send anything still being voted on."""
        return [self.deliver(r) for r in self.tracker.flush()]
