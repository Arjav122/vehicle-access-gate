"""Frame voting: many reads of one car → ONE read sent (brief §11.4).

A car in front of the camera is read several times a second, often slightly differently
(KA05MN0042, KA05MNOO42, KA05MN004). Reads within 2 edits of a track join it (1 edit split one
car into several tracks in practice; brief §17). The track's text is the one with the highest
summed confidence. A track is sent:

- early, as soon as one text has `min_agreeing` identical reads, or
- when the plate has been out of view for `gap_seconds`, with whatever it has.

Either way each track is sent once.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime


def levenshtein(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


@dataclass
class Read:
    """One OCR read of one plate in one frame."""

    text: str
    confidence: float
    at: datetime
    snapshot: bytes | None = None  # JPEG of the frame, kept for the best read


@dataclass
class Track:
    reads: list[Read] = field(default_factory=list)
    sent: bool = False

    @property
    def last_seen(self) -> datetime:
        return self.reads[-1].at

    def votes(self) -> dict[str, float]:
        totals: dict[str, float] = defaultdict(float)
        for r in self.reads:
            totals[r.text] += r.confidence
        return totals

    def winner(self) -> Read:
        """The best read of the winning text (highest summed confidence)."""
        totals = self.votes()
        text = max(totals, key=lambda t: totals[t])
        best = max((r for r in self.reads if r.text == text), key=lambda r: r.confidence)
        count = sum(1 for r in self.reads if r.text == text)
        return Read(
            text=text, confidence=totals[text] / count, at=self.reads[0].at, snapshot=best.snapshot
        )

    def agreeing(self) -> int:
        counts: dict[str, int] = defaultdict(int)
        for r in self.reads:
            counts[r.text] += 1
        return max(counts.values(), default=0)


class PlateTracker:
    def __init__(self, min_agreeing: int = 3, gap_seconds: float = 2.0, group_distance: int = 2):
        self.min_agreeing = min_agreeing
        self.gap_seconds = gap_seconds
        self.group_distance = group_distance
        self.tracks: list[Track] = []

    def _track_for(self, text: str) -> Track | None:
        best: Track | None = None
        best_d = self.group_distance + 1
        for track in self.tracks:
            d = min(levenshtein(text, r.text) for r in track.reads)
            if d < best_d:
                best, best_d = track, d
        return best

    def add(self, read: Read) -> list[Read]:
        """Add a read; returns reads that are ready to send now (0 or 1)."""
        ready = self.expire(read.at)
        track = self._track_for(read.text)
        if track is None:
            track = Track()
            self.tracks.append(track)
        track.reads.append(read)
        if not track.sent and track.agreeing() >= self.min_agreeing:
            track.sent = True
            ready.append(track.winner())
        return ready

    def expire(self, now: datetime) -> list[Read]:
        """Close tracks not seen for gap_seconds; returns the unsent ones' winners."""
        ready: list[Read] = []
        alive: list[Track] = []
        for track in self.tracks:
            if (now - track.last_seen).total_seconds() >= self.gap_seconds:
                if not track.sent:
                    ready.append(track.winner())
            else:
                alive.append(track)
        self.tracks = alive
        return ready

    def flush(self) -> list[Read]:
        """End of the stream (or "scan again"): send everything not yet sent."""
        ready = [t.winner() for t in self.tracks if not t.sent]
        self.tracks = []
        return ready
