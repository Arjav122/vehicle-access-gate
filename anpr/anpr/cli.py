"""Run the ANPR worker.

python -m anpr.cli --source 0                     # laptop webcam (entry lane)
python -m anpr.cli --source 0 --preview           # webcam + local demo page on :8765
python -m anpr.cli --source clip.mp4 --direction exit
python -m anpr.cli --source photos/ --dry-run     # one read per image, nothing sent
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

from anpr.buffer import OfflineBuffer
from anpr.client import GateClient
from anpr.config import Settings, load_settings
from anpr.detector import PlateDetector
from anpr.pipeline import Courier, Delivery, Pipeline, dry_run
from anpr.sources import frames, kind_of
from anpr.tracker import PlateTracker

log = logging.getLogger("anpr")


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="anpr", description="Read number plates and send one read per car to the server."
    )
    p.add_argument(
        "--source", default="0", help="webcam index, rtsp/http URL, video file, or image folder"
    )
    p.add_argument(
        "--direction",
        choices=["entry", "exit"],
        default="entry",
        help="which lane (and device key)",
    )
    p.add_argument("--dry-run", action="store_true", help="read plates but send nothing")
    p.add_argument("--preview", action="store_true", help="serve the local webcam demo page")
    p.add_argument(
        "--start",
        default=None,
        help="for recordings: ISO time the video starts (default: file time)",
    )
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args(argv)


def buffer_path(settings: Settings, direction: str) -> Path:
    """One offline buffer per lane: buffer-entry.sqlite, buffer-exit.sqlite."""
    base = settings.buffer_path
    return base.with_name(f"{base.stem}-{direction}{base.suffix}")


def make_courier(settings: Settings, direction: str) -> Courier:
    key = settings.device_key if direction == "entry" else settings.exit_device_key
    client = GateClient(settings.api_url, key, settings.max_retries)
    return Courier(client, OfflineBuffer(buffer_path(settings, direction)), direction)


def make_ocr():  # noqa: ANN201 - imported lazily: PaddleOCR is an optional extra
    from anpr.ocr import PaddleOcrEngine

    return PaddleOcrEngine()


def describe(d: Delivery) -> str:
    plate = f"{d.read.text} ({d.read.confidence:.2f})"
    if d.rejected:
        return f"{plate} → rejected: {d.rejected}"
    if d.queued:
        return f"{plate} → server unreachable, kept in the offline buffer"
    if d.answer is None:
        return f"{plate} → (dry run)"
    event = d.answer["event"]
    return f"{plate} → {d.answer['status']}: {event['plate']} = {event['matchResult']}" + (
        f" (flat {event['vehicle']['flatLabel']})" if event.get("vehicle") else ""
    )


def run(args: argparse.Namespace, settings: Settings) -> int:
    detector = PlateDetector(
        settings.detector_model,
        settings.detector_input_size,
        settings.detector_confidence,
        settings.detector_iou,
    )
    deliver = dry_run(args.direction) if args.dry_run else make_courier(settings, args.direction)
    tracker = PlateTracker(settings.track_min_agreeing_reads, settings.track_gap_seconds)
    pipeline = Pipeline(detector, make_ocr(), deliver, tracker, settings.ocr_contrast)

    start = datetime.fromisoformat(args.start) if args.start else None
    live = kind_of(args.source) in ("webcam", "stream")
    min_gap = 1.0 / settings.sample_fps if settings.sample_fps > 0 else 0.0
    last = 0.0
    sent = 0
    for frame in frames(
        args.source,
        width=settings.camera_width,
        height=settings.camera_height,
        fps=settings.sample_fps,
        start=start,
    ):
        if live:  # sample live cameras at SAMPLE_FPS; recordings are sampled by the source
            now = time.monotonic()
            if now - last < min_gap:
                continue
            last = now
        result = pipeline.process(frame)
        if args.verbose and result.boxes:
            texts = [t.text if t else "?" for t in result.texts]
            log.info(
                "%s %s: %d plate(s) %s", frame.at.isoformat(), frame.name, len(result.boxes), texts
            )
        for d in result.deliveries:
            sent += 1
            print(describe(d), flush=True)
    for d in pipeline.finish():
        sent += 1
        print(describe(d), flush=True)
    print(f"Done: {sent} read(s).")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING, format="%(message)s"
    )
    settings = load_settings()
    if args.preview:
        from anpr.preview import serve

        return serve(args, settings)
    try:
        return run(args, settings)
    except (FileNotFoundError, RuntimeError, ValueError) as err:
        print(f"Error: {err}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
