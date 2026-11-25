"""Crop, preprocessing and how OCR lines become one plate text."""

import numpy as np

from anpr.detector import Box
from anpr.ocr import TARGET_HEIGHT, Line, combine, crop, preprocess, read_plate
from tests.conftest import ScriptedOcr, scene


def test_crop_adds_a_margin_and_stays_inside_the_image():
    image = np.zeros((100, 200, 3), np.uint8)
    assert crop(image, Box(50, 40, 150, 60, 0.9)).shape == (23, 116, 3)  # 40-1.6→38, 60+1.6→61
    assert crop(image, Box(0, 0, 200, 100, 0.9)).shape == (100, 200, 3)


def test_preprocess_scales_to_a_readable_height_in_grey():
    out = preprocess(np.full((30, 120, 3), 200, np.uint8))
    assert out.shape == (TARGET_HEIGHT, 384, 3)
    assert (out[..., 0] == out[..., 1]).all()  # grey, as 3 channels for the OCR engine


def test_preprocess_with_contrast_still_returns_the_same_shape():
    assert preprocess(np.full((30, 120, 3), 200, np.uint8), contrast=True).shape == (
        TARGET_HEIGHT,
        384,
        3,
    )


def test_combine_joins_two_line_plates_top_to_bottom():
    lines = [Line("AB1234", 0.9, top=40), Line("UP16", 0.8, top=5)]
    assert combine(lines).text == "UP16AB1234"


def test_pieces_side_by_side_are_read_left_to_right():
    # Regression: PaddleOCR returned "22" / "BH" / "1234AA" with near-equal tops; sorting by top
    # alone produced "123422BHA" (or similar) instead of 22BH1234AA.
    lines = [
        Line("1234AA", 0.99, top=19, left=184, height=40),
        Line("22", 0.99, top=21, left=43, height=40),
        Line("BH", 0.99, top=20, left=113, height=40),
    ]
    assert combine(lines).text == "22BH1234AA"


def test_two_rows_each_read_left_to_right():
    lines = [
        Line("1234", 0.9, top=60, left=120, height=40),
        Line("16", 0.9, top=8, left=90, height=40),
        Line("AB", 0.9, top=62, left=20, height=40),
        Line("UP", 0.9, top=10, left=20, height=40),
    ]
    assert combine(lines).text == "UP16AB1234"


def test_combine_uses_the_lowest_line_confidence():
    assert combine([Line("UP16", 0.95, 0), Line("AB1234", 0.6, 30)]).confidence == 0.6


def test_combine_drops_a_line_that_is_only_the_ind_mark():
    for ind in ("IND", "IN0", "1ND", "INO"):
        assert combine([Line(ind, 0.99, 0), Line("UP16AB1234", 0.9, 10)]).text == "UP16AB1234"


def test_combine_keeps_everything_else_for_the_server_to_repair():
    # The worker does NOT fix O/0 etc.: the server repairs plates in one place.
    assert combine([Line("kao5 mn-oo42", 0.7, 0)]).text == "KAO5MNOO42"


def test_combine_returns_none_when_nothing_is_readable():
    assert combine([]) is None
    assert combine([Line("  -- ", 0.5, 0), Line("IND", 0.9, 1)]) is None


def test_read_plate_runs_the_whole_chain():
    ocr = ScriptedOcr([[("UP16", 0.9), ("AB1234", 0.85)]])
    text = read_plate(ocr, scene(), Box(460, 470, 820, 550, 0.9))
    assert (text.text, text.confidence) == ("UP16AB1234", 0.85)
    assert ocr.calls == 1
