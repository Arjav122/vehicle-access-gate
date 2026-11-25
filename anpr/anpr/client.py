"""Send one read to the server: POST /api/gate-events with the device key (brief §11.5).

Retries with exponential backoff on network errors, 5xx and 429 (honouring Retry-After).
Any other 4xx is permanent: retrying would fail again, so the caller sets it aside.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx


@dataclass(frozen=True)
class Outbound:
    plate_text: str
    confidence: float
    captured_at: datetime
    direction: str
    snapshot: bytes | None = None


class TransientError(Exception):
    """The server could not be reached or was busy; try again later."""


class PermanentError(Exception):
    """The server rejected the read (4xx); sending it again will not help."""

    def __init__(self, status: int, detail: str):
        super().__init__(f"{status}: {detail}")
        self.status = status
        self.detail = detail


def _detail(response: httpx.Response) -> str:
    try:
        return str(response.json().get("detail", response.text))
    except ValueError:
        return response.text[:200]


class GateClient:
    def __init__(
        self,
        api_url: str,
        device_key: str,
        max_retries: int = 4,
        http: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if not device_key:
            raise ValueError(
                "No device key. Run `npm run webcam:devices` in server/, or set ANPR_DEVICE_KEY."
            )
        self.http = http or httpx.Client(base_url=api_url.rstrip("/"), timeout=15)
        self.headers = {"X-Device-Key": device_key}
        self.max_retries = max_retries
        self.sleep = sleep

    def whoami(self) -> dict[str, Any]:
        """Check the key: the server says which device and lane this is."""
        response = self.http.get("/api/devices/me", headers=self.headers)
        if response.status_code != 200:
            raise PermanentError(response.status_code, _detail(response))
        return response.json()

    def send(self, read: Outbound) -> dict[str, Any]:
        """Deliver a read; returns the server's answer ({status, event})."""
        data = {
            "plate_text": read.plate_text,
            "confidence": f"{read.confidence:.4f}",
            "captured_at": read.captured_at.isoformat(),
            "direction": read.direction,
        }
        files = (
            {"snapshot": ("snapshot.jpg", read.snapshot, "image/jpeg")} if read.snapshot else None
        )
        last_error = "unknown error"
        for attempt in range(self.max_retries + 1):
            try:
                response = self.http.post(
                    "/api/gate-events", data=data, files=files, headers=self.headers
                )
            except httpx.TransportError as err:
                last_error = f"network: {err}"
                wait = min(8.0, 0.5 * 2**attempt)
            else:
                if response.status_code in (200, 201):
                    return response.json()
                if response.status_code == 429 or response.status_code >= 500:
                    last_error = f"{response.status_code}: {_detail(response)}"
                    retry_after = response.headers.get("Retry-After", "")
                    wait = (
                        float(retry_after) if retry_after.isdigit() else min(8.0, 0.5 * 2**attempt)
                    )
                else:
                    raise PermanentError(response.status_code, _detail(response))
            if attempt < self.max_retries:
                self.sleep(wait)
        raise TransientError(last_error)
