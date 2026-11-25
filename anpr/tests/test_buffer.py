"""Offline buffer: durable, ordered replay, outages pause it, rejections don't block it."""

import sqlite3
from datetime import UTC, datetime, timedelta

from anpr.buffer import OfflineBuffer
from anpr.client import Outbound, PermanentError, TransientError

T0 = datetime(2026, 11, 25, 8, 0, tzinfo=UTC)


def read(plate: str, minute: int = 0) -> Outbound:
    return Outbound(plate, 0.9, T0 + timedelta(minutes=minute), "entry", b"jpg")


class FakeClient:
    """Answers per plate: 'ok', 'down' (transient) or 'reject' (permanent)."""

    def __init__(self, behaviour: dict[str, str] | None = None):
        self.behaviour = behaviour or {}
        self.sent: list[str] = []

    def send(self, r: Outbound) -> dict:
        mode = self.behaviour.get(r.plate_text, "ok")
        if mode == "down":
            raise TransientError("server unreachable")
        if mode == "reject":
            raise PermanentError(422, "bad read")
        self.sent.append(r.plate_text)
        return {"status": "created", "event": {"plate": r.plate_text}}


def test_uses_wal_and_full_sync(tmp_path):
    buf = OfflineBuffer(tmp_path / "b.sqlite")
    assert buf._db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert buf._db.execute("PRAGMA synchronous").fetchone()[0] == 2  # FULL


def test_outage_keeps_reads_and_replays_them_oldest_first(tmp_path):
    buf = OfflineBuffer(tmp_path / "b.sqlite")
    down = FakeClient({"A": "down"})
    for plate in ["A", "B", "C"]:
        buf.add(read(plate))
    result = buf.drain(down)
    assert result.stopped == "server unreachable"
    assert down.sent == [] and buf.pending_count() == 3  # B and C wait behind A: order kept

    up = FakeClient()
    result = buf.drain(up)
    assert up.sent == ["A", "B", "C"]
    assert [answer["event"]["plate"] for _, answer in result.sent] == ["A", "B", "C"]
    assert buf.pending_count() == 0


def test_reads_survive_a_restart(tmp_path):
    path = tmp_path / "b.sqlite"
    buf = OfflineBuffer(path)
    buf.add(read("A", 1))
    buf.add(read("B", 2))
    buf.close()

    again = OfflineBuffer(path)
    client = FakeClient()
    again.drain(client)
    assert client.sent == ["A", "B"]


def test_a_permanent_rejection_is_set_aside_without_blocking_the_queue(tmp_path):
    buf = OfflineBuffer(tmp_path / "b.sqlite")
    for plate in ["A", "BAD", "C"]:
        buf.add(read(plate))
    client = FakeClient({"BAD": "reject"})
    result = buf.drain(client)
    assert client.sent == ["A", "C"]
    assert len(result.rejected) == 1 and buf.rejected_count() == 1
    row = (
        sqlite3.connect(tmp_path / "b.sqlite")
        .execute("SELECT plate_text, status, detail FROM rejected")
        .fetchone()
    )
    assert row == ("BAD", 422, "bad read")


def test_keeps_the_capture_time_and_snapshot(tmp_path):
    buf = OfflineBuffer(tmp_path / "b.sqlite")
    buf.add(Outbound("A", 0.71, T0, "exit", b"\xff\xd8\xffjpeg"))
    got: list[Outbound] = []

    class Spy(FakeClient):
        def send(self, r: Outbound) -> dict:
            got.append(r)
            return super().send(r)

    buf.drain(Spy())
    assert got == [Outbound("A", 0.71, T0, "exit", b"\xff\xd8\xffjpeg")]
