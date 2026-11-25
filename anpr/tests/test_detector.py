"""Detector maths against hand-built tensors, plus the real model on a synthetic plate."""

import numpy as np
import pytest

from anpr.detector import Letterbox, PlateDetector, decode, letterbox, nms, to_original
from tests.conftest import MODEL, PLATE_BOX, needs_model, scene


def test_letterbox_keeps_aspect_ratio_and_centres_with_grey_padding():
    image = np.zeros((360, 640, 3), np.uint8)  # 16:9
    out, lb = letterbox(image, 640)
    assert out.shape == (640, 640, 3)
    assert lb.scale == 1.0
    assert (lb.pad_x, lb.pad_y) == (0, 140)
    assert (out[0, 0] == 114).all() and (out[639, 639] == 114).all()
    assert (out[320, 320] == 0).all()


def yolo_output(rows: list[tuple[float, float, float, float, float]]) -> np.ndarray:
    """Build a (1, 5, N) tensor from (cx, cy, w, h, score) rows, like the model returns."""
    return np.array(rows, dtype=np.float32).T[None]


def test_decode_converts_centres_to_corners_and_filters_by_score():
    out = yolo_output([(100, 50, 40, 20, 0.9), (300, 300, 10, 10, 0.1)])
    boxes, scores = decode(out, conf_threshold=0.35)
    np.testing.assert_allclose(boxes, [[80, 40, 120, 60]])
    np.testing.assert_allclose(scores, [0.9])


def test_nms_drops_overlapping_boxes_and_keeps_separate_ones():
    boxes = np.array([[0, 0, 100, 100], [5, 5, 105, 105], [300, 300, 400, 400]], np.float32)
    scores = np.array([0.8, 0.9, 0.7], np.float32)
    assert nms(boxes, scores, iou_threshold=0.5) == [1, 2]


def test_nms_of_nothing_is_nothing():
    assert nms(np.zeros((0, 4), np.float32), np.zeros((0,), np.float32), 0.5) == []


def test_to_original_undoes_letterboxing_and_clips():
    lb = Letterbox(scale=0.5, pad_x=0, pad_y=140)
    boxes = np.array([[10, 150, 50, 170], [-20, 100, 700, 900]], np.float32)
    out = to_original(boxes, lb, width=1280, height=720)
    np.testing.assert_allclose(out[0], [20, 20, 100, 60])
    np.testing.assert_allclose(out[1], [0, 0, 1280, 720])


def test_missing_model_gives_a_helpful_error(tmp_path):
    with pytest.raises(FileNotFoundError, match="download_model"):
        PlateDetector(tmp_path / "nope.onnx")


@needs_model
def test_real_model_finds_the_plate_in_a_synthetic_scene():
    boxes = PlateDetector(MODEL).detect(scene())
    assert len(boxes) == 1
    b = boxes[0]
    x1, y1, x2, y2 = PLATE_BOX
    assert (
        abs(b.x1 - x1) < 20 and abs(b.y1 - y1) < 20 and abs(b.x2 - x2) < 20 and abs(b.y2 - y2) < 20
    )
    assert b.score > 0.5


@needs_model
def test_real_model_finds_nothing_in_an_empty_frame():
    assert PlateDetector(MODEL).detect(np.full((720, 1280, 3), 90, np.uint8)) == []
