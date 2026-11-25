"""Where frames come from (brief §11.1): a webcam index, an RTSP/HTTP stream, a video file,
or a folder of images.

Timestamps: live cameras use the wall clock; recordings use their own timeline (start time +
position in the video), so re-running a recording produces the same events.
"""

from __future__ import annotations

import sys
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import cv2
import numpy as np

IMAGE_TYPES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


@dataclass(frozen=True)
class Frame:
    image: np.ndarray
    at: datetime
    # A still photo is its own "car": the pipeline flushes the tracker after each one.
    still: bool = False
    name: str = ""


def kind_of(source: str) -> str:
    if source.isdigit():
        return "webcam"
    if source.startswith(("rtsp://", "http://", "https://")):
        return "stream"
    if Path(source).is_dir():
        return "folder"
    return "video"


def open_webcam(index: int, width: int, height: int) -> cv2.VideoCapture:
    # On Windows, DirectShow opens fast and honours the requested resolution.
    backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
    cap = cv2.VideoCapture(index, backend)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    return cap


def live_frames(cap: cv2.VideoCapture) -> Iterator[Frame]:
    while True:
        ok, image = cap.read()
        if not ok:
            return
        yield Frame(image=image, at=datetime.now(UTC))


def video_frames(path: str, start: datetime, fps: float) -> Iterator[Frame]:
    """Frames of a recording, sampled at `fps`, timed on the recording's own clock."""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise FileNotFoundError(f"Cannot open video: {path}")
    video_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, round(video_fps / fps)) if fps > 0 else 1
    index = 0
    try:
        while True:
            ok, image = cap.read()
            if not ok:
                return
            if index % step == 0:
                yield Frame(image=image, at=start + timedelta(seconds=index / video_fps))
            index += 1
    finally:
        cap.release()


def folder_frames(folder: str) -> Iterator[Frame]:
    """Each image is one still, timed by its file's modification time."""
    for path in sorted(Path(folder).iterdir()):
        if path.suffix.lower() not in IMAGE_TYPES:
            continue
        image = cv2.imread(str(path))
        if image is None:
            continue
        at = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
        yield Frame(image=image, at=at, still=True, name=path.name)


def frames(
    source: str, *, width: int, height: int, fps: float, start: datetime | None = None
) -> Iterator[Frame]:
    """Frames from any supported source."""
    kind = kind_of(source)
    if kind == "folder":
        return folder_frames(source)
    if kind == "video":
        path = Path(source)
        if not path.exists():
            raise FileNotFoundError(f"No such video file or folder: {source}")
        begin = start or datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
        return video_frames(source, begin, fps)
    cap = open_webcam(int(source), width, height) if kind == "webcam" else cv2.VideoCapture(source)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open camera/stream: {source}")
    return live_frames(cap)
