"""Offline buffer: reads wait in SQLite until the server takes them (brief §11.5).

- Every read is written here FIRST, then the queue is drained oldest-first, so new reads always
  queue behind old ones and order is kept.
- WAL + synchronous=FULL: a read that was accepted survives a power cut.
- A server outage stops the drain (the read stays; we retry later).
- A permanent 4xx rejection moves the read to a `rejected` table instead of blocking the queue.

Replaying is safe because the server deduplicates (event hash) and debounces by capture time.
"""

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from anpr.client import GateClient, Outbound, PermanentError, TransientError

SCHEMA = """
CREATE TABLE IF NOT EXISTS pending (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate_text TEXT NOT NULL,
  confidence REAL NOT NULL,
  captured_at TEXT NOT NULL,
  direction TEXT NOT NULL,
  snapshot BLOB
);
CREATE TABLE IF NOT EXISTS rejected (
  id INTEGER PRIMARY KEY,
  plate_text TEXT NOT NULL,
  confidence REAL NOT NULL,
  captured_at TEXT NOT NULL,
  direction TEXT NOT NULL,
  status INTEGER NOT NULL,
  detail TEXT NOT NULL,
  rejected_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


@dataclass
class DrainResult:
    sent: list[tuple[int, dict[str, Any]]] = field(default_factory=list)  # (row id, server answer)
    rejected: list[tuple[int, PermanentError]] = field(default_factory=list)
    stopped: str | None = None  # why draining stopped early (server unreachable)


class OfflineBuffer:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=FULL")
        self._db.executescript(SCHEMA)
        self._lock = threading.Lock()

    def add(self, read: Outbound) -> int:
        with self._lock:
            cur = self._db.execute(
                "INSERT INTO pending (plate_text, confidence, captured_at, direction, snapshot)"
                " VALUES (?, ?, ?, ?, ?)",
                (
                    read.plate_text,
                    read.confidence,
                    read.captured_at.isoformat(),
                    read.direction,
                    read.snapshot,
                ),
            )
            return int(cur.lastrowid or 0)

    def pending_count(self) -> int:
        return int(self._db.execute("SELECT count(*) FROM pending").fetchone()[0])

    def rejected_count(self) -> int:
        return int(self._db.execute("SELECT count(*) FROM rejected").fetchone()[0])

    def drain(self, client: GateClient) -> DrainResult:
        """Send pending reads oldest-first until the queue is empty or the server is unreachable."""
        result = DrainResult()
        with self._lock:
            while True:
                row = self._db.execute(
                    "SELECT id, plate_text, confidence, captured_at, direction, snapshot"
                    " FROM pending ORDER BY id LIMIT 1"
                ).fetchone()
                if row is None:
                    return result
                row_id, plate, conf, captured, direction, snapshot = row
                read = Outbound(plate, conf, datetime.fromisoformat(captured), direction, snapshot)
                try:
                    answer = client.send(read)
                except TransientError as err:
                    result.stopped = str(err)
                    return result
                except PermanentError as err:
                    self._db.execute(
                        "INSERT INTO rejected"
                        " (id, plate_text, confidence, captured_at, direction, status, detail)"
                        " VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (row_id, plate, conf, captured, direction, err.status, err.detail),
                    )
                    self._db.execute("DELETE FROM pending WHERE id = ?", (row_id,))
                    result.rejected.append((row_id, err))
                    continue
                self._db.execute("DELETE FROM pending WHERE id = ?", (row_id,))
                result.sent.append((row_id, answer))

    def close(self) -> None:
        self._db.close()
