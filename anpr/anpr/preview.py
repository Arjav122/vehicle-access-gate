"""Laptop webcam demo page (brief §11.6), standard library http.server only.

    python -m anpr.cli --source 0 --preview   →   http://127.0.0.1:8765

Three threads:
  camera   – keeps only the newest frame (old frames are useless for a live demo)
  analysis – owns the pipeline: detect → OCR → vote → send; draws boxes on the frame
  web      – serves the page, an MJPEG video stream, the current state, and button actions

Security, because any website you visit could try to talk to a local port:
  - binds to 127.0.0.1 only, and checks the Host header (blocks DNS-rebinding tricks)
  - buttons POST JSON with a custom header (X-Preview-Action), which other sites cannot send
    without a CORS preflight we never approve
  - CSP: scripts only with this response's nonce; frame-ancestors 'none' (no clickjacking)
"""

from __future__ import annotations

import csv
import json
import secrets
import threading
import time
from argparse import Namespace
from datetime import UTC, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

import cv2
import numpy as np

from anpr.config import ANPR_ROOT, Settings
from anpr.pipeline import Delivery, Pipeline, encode_jpeg
from anpr.sources import open_webcam
from anpr.tracker import PlateTracker

PAGE = (Path(__file__).parent / "preview.html").read_text(encoding="utf-8")
SAVE_DIR = ANPR_ROOT / "eval" / "data" / "webcam"
ACTIONS = {"entry", "exit", "rescan", "save"}


# ---------------------------------------------------------------------------
# What the server's answer means, in words (colour is never the only signal)
# ---------------------------------------------------------------------------


def explain(d: Delivery) -> dict[str, Any]:
    if d.rejected:
        return {"tone": "error", "text": f"Server rejected the read: {d.rejected}"}
    if d.queued:
        return {
            "tone": "warn",
            "text": "Server offline: read saved, it will be sent when the server is back",
        }
    if d.answer is None:
        return {"tone": "info", "text": "Dry run: nothing was sent"}
    event = d.answer["event"]
    result = event["matchResult"]
    flat = f" (flat {event['vehicle']['flatLabel']})" if event.get("vehicle") else ""
    lane = d.direction
    texts = {
        "resident": ("ok", f"Resident car{flat}: {lane} logged"),
        "visitor": (
            "ok",
            "Expected visitor: let them in" if lane == "entry" else "Visitor leaving: visit closed",
        ),
        "guest_pass": ("ok", "Guest pass: let them in"),
        "watchlist": ("error", "Watchlist plate: stop the car and call security"),
        "low_confidence": ("warn", "Unclear read: the guard will check it"),
        "ambiguous": ("warn", "Looks like two known plates: the guard will check it"),
        "unknown": ("info", "New car: register the visitor"),
    }
    tone, text = texts.get(result, ("info", result))
    if d.answer["status"] != "created":
        text += f" (already seen: {d.answer['status']})"
    return {"tone": tone, "text": text, "eventId": event["id"], "matchResult": result}


# ---------------------------------------------------------------------------
# The worker: camera + analysis threads, and button actions
# ---------------------------------------------------------------------------


class PreviewWorker(Protocol):
    def state(self) -> dict[str, Any]: ...
    def latest_jpeg(self) -> bytes | None: ...
    def act(self, action: str, plate: str | None) -> dict[str, Any]: ...


class Worker:
    def __init__(
        self, settings: Settings, pipelines: dict[str, Pipeline], camera: cv2.VideoCapture
    ):
        self.settings = settings
        self.pipelines = pipelines  # one per lane, each with its own device key and offline buffer
        self.camera = camera
        self.direction = "entry"
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self._frame: np.ndarray | None = None
        self._jpeg: bytes | None = None
        self._state: dict[str, Any] = {"plate": None, "confidence": None, "decision": None}

    # -- threads --

    def camera_loop(self) -> None:
        while not self.stop.is_set():
            ok, frame = self.camera.read()
            if not ok:
                time.sleep(0.05)
                continue
            with self.lock:
                self._frame = frame

    def analysis_loop(self) -> None:
        period = 1.0 / max(self.settings.sample_fps, 0.1)
        while not self.stop.is_set():
            started = time.monotonic()
            with self.lock:
                frame = None if self._frame is None else self._frame.copy()
                direction = self.direction
            if frame is not None:
                self._analyse(frame, direction)
            time.sleep(max(0.0, period - (time.monotonic() - started)))

    def _analyse(self, frame: np.ndarray, direction: str) -> None:
        from anpr.sources import Frame

        result = self.pipelines[direction].process(Frame(image=frame, at=datetime.now(UTC)))
        for box, text in zip(result.boxes, result.texts, strict=False):
            p1, p2 = (int(box.x1), int(box.y1)), (int(box.x2), int(box.y2))
            cv2.rectangle(frame, p1, p2, (0, 200, 0), 2)
            label = f"{text.text} {text.confidence:.2f}" if text else "?"
            cv2.putText(
                frame,
                label,
                (p1[0], max(20, p1[1] - 8)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 200, 0),
                2,
            )
        with self.lock:
            self._jpeg = encode_jpeg(frame)
            for d in result.deliveries:
                self._state = {
                    "plate": d.read.text,
                    "confidence": round(d.read.confidence, 2),
                    "decision": explain(d),
                }

    # -- for the web thread --

    def state(self) -> dict[str, Any]:
        with self.lock:
            s = dict(self._state)
            s["direction"] = self.direction
            decision = s.get("decision") or {}
            if decision.get("matchResult") == "unknown" and s.get("plate"):
                s["registerUrl"] = (
                    f"{self.settings.web_url.rstrip('/')}/guard?register={quote(s['plate'])}"
                    f"&event={quote(decision.get('eventId', ''))}"
                )
            return s

    def latest_jpeg(self) -> bytes | None:
        with self.lock:
            return self._jpeg

    def act(self, action: str, plate: str | None) -> dict[str, Any]:
        with self.lock:
            if action in ("entry", "exit"):
                if action not in self.pipelines:
                    return {
                        "error": f"No device key for the {action} lane."
                        " Run `npm run webcam:devices`."
                    }
                self.direction = action
            elif action == "rescan":
                # Forget what is being voted on, so the car in view is read and sent again.
                for p in self.pipelines.values():
                    p.tracker.tracks = []
                self._state = {"plate": None, "confidence": None, "decision": None}
            elif action == "save":
                if self._frame is None or not plate:
                    return {"error": "Type the plate as printed, then press Save"}
                save_labelled(self._frame, plate)
        return self.state()


def save_labelled(frame: np.ndarray, plate: str, folder: Path = SAVE_DIR) -> Path:
    """Store a frame + the true plate, for measuring real accuracy (see DATASET.md)."""
    folder.mkdir(parents=True, exist_ok=True)
    name = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ") + ".jpg"
    cv2.imwrite(str(folder / name), frame)
    labels = folder / "labels.csv"
    new = not labels.exists()
    with labels.open("a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if new:
            writer.writerow(["filename", "plate"])
        writer.writerow([name, plate.strip().upper()])
    return folder / name


# ---------------------------------------------------------------------------
# The web server
# ---------------------------------------------------------------------------


def make_handler(worker: PreviewWorker, port: int) -> type[BaseHTTPRequestHandler]:
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(BaseHTTPRequestHandler):
        server_version = "anpr-preview"

        def log_message(self, *args: Any) -> None:  # keep the console for plate reads
            pass

        def _guard(self) -> bool:
            if self.headers.get("Host", "") not in allowed_hosts:
                self._send(HTTPStatus.FORBIDDEN, b"Forbidden host", "text/plain")
                return False
            return True

        def _send(self, status: HTTPStatus, body: bytes, ctype: str, nonce: str = "") -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            script = f"'nonce-{nonce}'" if nonce else "'none'"
            self.send_header(
                "Content-Security-Policy",
                f"default-src 'self'; script-src {script}; style-src 'self' 'unsafe-inline'; "
                "img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
            )
            self.end_headers()
            self.wfile.write(body)

        def _json(self, data: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
            self._send(status, json.dumps(data).encode(), "application/json")

        def do_GET(self) -> None:  # noqa: N802 - http.server naming
            if not self._guard():
                return
            if self.path == "/":
                nonce = secrets.token_urlsafe(16)
                self._send(
                    HTTPStatus.OK,
                    PAGE.replace("{{NONCE}}", nonce).encode(),
                    "text/html; charset=utf-8",
                    nonce,
                )
            elif self.path == "/state.json":
                self._json(worker.state())
            elif self.path == "/stream.mjpg":
                self._stream()
            else:
                self._send(HTTPStatus.NOT_FOUND, b"Not found", "text/plain")

        def do_POST(self) -> None:  # noqa: N802
            if not self._guard():
                return
            if self.path != "/action" or self.headers.get("X-Preview-Action") != "1":
                self._send(HTTPStatus.FORBIDDEN, b"Forbidden", "text/plain")
                return
            if not self.headers.get("Content-Type", "").startswith("application/json"):
                self._send(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, b"JSON only", "text/plain")
                return
            length = min(int(self.headers.get("Content-Length") or 0), 4096)
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                body = {}
            action = body.get("action")
            if action not in ACTIONS:
                self._json({"error": "Unknown action"}, HTTPStatus.BAD_REQUEST)
                return
            plate = body.get("plate")
            self._json(worker.act(action, plate if isinstance(plate, str) else None))

        def _stream(self) -> None:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                while True:
                    jpeg = worker.latest_jpeg()
                    if jpeg:
                        self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\n")
                        self.wfile.write(
                            f"Content-Length: {len(jpeg)}\r\n\r\n".encode() + jpeg + b"\r\n"
                        )
                    time.sleep(0.1)
            except (BrokenPipeError, ConnectionResetError):
                return

    return Handler


def make_server(worker: PreviewWorker, port: int) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(worker, port))
    server.daemon_threads = True
    return server


def serve(args: Namespace, settings: Settings) -> int:
    from anpr.cli import make_courier, make_ocr
    from anpr.detector import PlateDetector

    if not args.source.isdigit():
        print("The preview page needs a webcam: --source 0 (or another camera index)")
        return 2
    detector = PlateDetector(
        settings.detector_model,
        settings.detector_input_size,
        settings.detector_confidence,
        settings.detector_iou,
    )
    ocr = make_ocr()
    pipelines: dict[str, Pipeline] = {}
    for lane, key in (("entry", settings.device_key), ("exit", settings.exit_device_key)):
        if key:
            tracker = PlateTracker(settings.track_min_agreeing_reads, settings.track_gap_seconds)
            pipelines[lane] = Pipeline(
                detector, ocr, make_courier(settings, lane), tracker, settings.ocr_contrast
            )
    if "entry" not in pipelines:
        print(
            "No ANPR_DEVICE_KEY. In server/, run `npm run webcam:devices` first"
            " (it writes anpr/.env)."
        )
        return 2

    camera = open_webcam(int(args.source), settings.camera_width, settings.camera_height)
    if not camera.isOpened():
        print(f"Cannot open webcam {args.source}")
        return 2
    worker = Worker(settings, pipelines, camera)
    threads = [
        threading.Thread(target=worker.camera_loop, daemon=True),
        threading.Thread(target=worker.analysis_loop, daemon=True),
    ]
    for t in threads:
        t.start()
    server = make_server(worker, settings.preview_port)
    print(f"Webcam demo: http://127.0.0.1:{settings.preview_port}   (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        worker.stop.set()
        server.server_close()
        camera.release()
    return 0
