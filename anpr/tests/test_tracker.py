"""Frame voting: one car in front of the camera = one read sent."""

from datetime import UTC, datetime, timedelta

from anpr.tracker import PlateTracker, Read, levenshtein

T0 = datetime(2026, 11, 25, 8, 0, tzinfo=UTC)


def r(text: str, seconds: float, conf: float = 0.9) -> Read:
    return Read(text=text, confidence=conf, at=T0 + timedelta(seconds=seconds))


def test_levenshtein():
    assert levenshtein("KA05MN0042", "KA05MN0042") == 0
    assert levenshtein("KA05MN0042", "KAO5MNOO42") == 3
    assert levenshtein("KA05MN0042", "KA05MN004") == 1


def test_sends_early_after_three_agreeing_reads_and_only_once():
    t = PlateTracker(min_agreeing=3)
    assert t.add(r("KA05MN0042", 0)) == []
    assert t.add(r("KA05MN0042", 0.2)) == []
    sent = t.add(r("KA05MN0042", 0.4))
    assert [s.text for s in sent] == ["KA05MN0042"]
    assert t.add(r("KA05MN0042", 0.6)) == []  # same car still there: nothing more
    assert t.expire(T0 + timedelta(seconds=10)) == []  # and nothing when it leaves


def test_noisy_reads_of_one_car_join_one_track_and_the_best_text_wins():
    t = PlateTracker(min_agreeing=5)
    for i, text in enumerate(["KA05MN0042", "KA05MNOO42", "KA05MN0042", "KA05MN004", "KA05MN0042"]):
        t.add(r(text, i * 0.2, conf=0.8))
    assert len(t.tracks) == 1
    [sent] = t.expire(T0 + timedelta(seconds=5))
    assert sent.text == "KA05MN0042"
    assert sent.at == T0  # the time the car was first seen


def test_reads_two_edits_apart_still_group_but_different_cars_do_not():
    t = PlateTracker(min_agreeing=99)
    t.add(r("UP16AB1234", 0))
    t.add(r("UP16AB12", 0.2))  # 2 edits: same car (brief §17: 1 edit split cars)
    t.add(r("KA05MN0042", 0.4))  # another car
    assert len(t.tracks) == 2


def test_sends_on_gap_when_reads_never_agree_three_times():
    t = PlateTracker(min_agreeing=3, gap_seconds=2)
    t.add(r("MH12DE1433", 0, conf=0.6))
    t.add(r("MH12DE1438", 0.2, conf=0.9))
    assert t.expire(T0 + timedelta(seconds=1)) == []
    [sent] = t.expire(T0 + timedelta(seconds=2.3))
    assert sent.text == "MH12DE1438"  # highest summed confidence


def test_flush_sends_whatever_is_unsent():
    t = PlateTracker(min_agreeing=3)
    t.add(r("UP16AB1234", 0))
    t.add(r("KA05MN0042", 0.1))
    assert sorted(s.text for s in t.flush()) == ["KA05MN0042", "UP16AB1234"]
    assert t.tracks == []


def test_the_sent_read_carries_the_snapshot_of_its_most_confident_frame():
    t = PlateTracker(min_agreeing=2)
    t.add(Read("UP16AB1234", 0.6, T0, snapshot=b"blurry"))
    [sent] = t.add(Read("UP16AB1234", 0.95, T0 + timedelta(seconds=0.2), snapshot=b"sharp"))
    assert sent.snapshot == b"sharp"
