"""The evaluation maths (AP, IoU, YOLO box parsing, labels) without running any model."""

import importlib.util
import sys
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "evaluate", Path(__file__).resolve().parent.parent / "eval" / "evaluate.py"
)
evaluate = importlib.util.module_from_spec(spec)
sys.modules["evaluate"] = evaluate  # dataclasses look their module up here
spec.loader.exec_module(evaluate)


def test_iou():
    assert evaluate.iou((0, 0, 10, 10), (0, 0, 10, 10)) == 1.0
    assert evaluate.iou((0, 0, 10, 10), (20, 20, 30, 30)) == 0.0
    assert evaluate.iou((0, 0, 10, 10), (5, 0, 15, 10)) == pytest.approx(1 / 3)


def test_average_precision():
    assert evaluate.average_precision([(0.9, True), (0.8, True)], n_truth=2) == 1.0
    assert evaluate.average_precision([(0.9, True)], n_truth=2) == 0.5
    assert evaluate.average_precision([(0.9, False), (0.8, True)], n_truth=1) == 0.5
    assert evaluate.average_precision([], n_truth=0) == 0.0


def test_yolo_boxes_and_labels(tmp_path):
    (tmp_path / "a.txt").write_text("0 0.5 0.5 0.2 0.1\n\n")
    assert evaluate.yolo_boxes(tmp_path / "a.txt", 1000, 500) == [(400.0, 225.0, 600.0, 275.0)]
    (tmp_path / "labels.csv").write_text("filename,plate\n1.jpg,up16 ab-1234\n")
    assert evaluate.load_labels(tmp_path) == [(tmp_path / "1.jpg", "UP16AB1234")]
