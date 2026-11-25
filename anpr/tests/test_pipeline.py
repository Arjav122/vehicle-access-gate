"""The whole worker on an image folder and a short video: one read per car reaches delivery."""

from datetime import UTC, datetime
from pathlib import Path

import cv2

from anpr.buffer import OfflineBuffer
from anpr.detector import PlateDetector
from anpr.pipeline import Courier, Delivery, Pipeline, dry_run
from anpr.sources import Frame, folder_frames, kind_of, video_frames
from anpr.tracker import PlateTracker, Read
from tests.conftest import MODEL, FixedDetector, ScriptedOcr, needs_model, scene
from tests.test_buffer import FakeClient


def collect(pipeline: Pipeline, frames) -> list[Delivery]:
    out: list[Delivery] = []
    for frame in frames:
        out += pipeline.process(frame).deliveries
    return out + pipeline.finish()


def test_kind_of_source(tmp_path):
    assert kind_of("0") == "webcam"
    assert kind_of("rtsp://cam.local/stream") == "stream"
    assert kind_of(str(tmp_path)) == "folder"
    assert kind_of("clip.mp4") == "video"


def test_image_folder_gives_one_read_per_photo(tmp_images: Path):
    for i, text in enumerate(["UP16 AB 1234", "KA 05 MN 0042"]):
        cv2.imwrite(str(tmp_images / f"{i}.jpg"), scene(text))
    (tmp_images / "notes.txt").write_text("not an image")
    ocr = ScriptedOcr([[("UP16AB1234", 0.9)], [("IND", 0.99), ("KA05MN0042", 0.8)]])
    deliveries = collect(
        Pipeline(FixedDetector(), ocr, dry_run("entry")), folder_frames(str(tmp_images))
    )
    assert [(d.read.text, d.read.confidence) for d in deliveries] == [
        ("UP16AB1234", 0.9),
        ("KA05MN0042", 0.8),
    ]
    assert all(d.read.snapshot and d.read.snapshot[:3] == b"\xff\xd8\xff" for d in deliveries)


def write_video(path: Path, seconds: float, fps: int = 25) -> None:
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (1280, 720))
    frame = scene()
    for _ in range(int(seconds * fps)):
        writer.write(frame)
    writer.release()


def test_video_samples_frames_on_its_own_clock(tmp_path):
    video = tmp_path / "car.avi"
    write_video(video, seconds=2)
    start = datetime(2026, 11, 25, 8, 0, tzinfo=UTC)
    frames = list(video_frames(str(video), start, fps=5))
    assert len(frames) == 10
    assert frames[0].at == start
    assert (frames[1].at - start).total_seconds() == 0.2


def test_a_car_held_in_front_of_the_camera_is_sent_once(tmp_path):
    video = tmp_path / "car.avi"
    write_video(video, seconds=3)
    start = datetime(2026, 11, 25, 8, 0, tzinfo=UTC)
    ocr = ScriptedOcr([[("UP16AB1234", 0.9)]] * 15)
    pipeline = Pipeline(FixedDetector(), ocr, dry_run("entry"), PlateTracker(min_agreeing=3))
    deliveries = collect(pipeline, video_frames(str(video), start, fps=5))
    assert [d.read.text for d in deliveries] == ["UP16AB1234"]
    assert deliveries[0].read.at == start


def test_frames_without_plates_send_nothing():
    pipeline = Pipeline(FixedDetector(found=False), ScriptedOcr([]), dry_run("entry"))
    result = pipeline.process(Frame(scene(), datetime.now(UTC)))
    assert result.boxes == [] and result.deliveries == []


def test_courier_writes_to_the_buffer_first_and_reports_the_server_answer(tmp_path):
    buffer = OfflineBuffer(tmp_path / "b.sqlite")
    courier = Courier(FakeClient(), buffer, "exit")
    d = courier(Read("UP16AB1234", 0.9, datetime.now(UTC), b"jpg"))
    assert d.answer == {"status": "created", "event": {"plate": "UP16AB1234"}}
    assert (d.queued, d.direction, buffer.pending_count()) == (False, "exit", 0)


def test_courier_keeps_the_read_when_the_server_is_down(tmp_path):
    buffer = OfflineBuffer(tmp_path / "b.sqlite")
    d = Courier(FakeClient({"UP16AB1234": "down"}), buffer, "entry")(
        Read("UP16AB1234", 0.9, datetime.now(UTC))
    )
    assert d.queued and d.answer is None
    assert buffer.pending_count() == 1


@needs_model
def test_real_detector_end_to_end_on_a_folder(tmp_images: Path):
    cv2.imwrite(str(tmp_images / "car.jpg"), scene("MH 12 DE 1433"))
    ocr = ScriptedOcr([[("MH12DE1433", 0.88)]])
    deliveries = collect(
        Pipeline(PlateDetector(MODEL), ocr, dry_run("entry")), folder_frames(str(tmp_images))
    )
    assert [d.read.text for d in deliveries] == ["MH12DE1433"]
