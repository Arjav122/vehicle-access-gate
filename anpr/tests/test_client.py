"""HTTP client: success, retries with backoff, Retry-After, permanent rejections."""

from datetime import UTC, datetime

import httpx
import pytest

from anpr.client import GateClient, Outbound, PermanentError, TransientError

READ = Outbound(
    "UP16AB1234", 0.93, datetime(2026, 11, 25, 8, 0, tzinfo=UTC), "entry", b"\xff\xd8\xffjpeg"
)


def client_for(
    responses: list, sleeps: list[float] | None = None
) -> tuple[GateClient, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        item = responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    http = httpx.Client(base_url="http://api.test", transport=httpx.MockTransport(handler))
    sleep_log = sleeps if sleeps is not None else []
    return GateClient(
        "http://api.test", "vd_test", max_retries=3, http=http, sleep=sleep_log.append
    ), seen


def ok(status="created"):
    return httpx.Response(
        201, json={"status": status, "event": {"id": "e1", "plate": "UP16AB1234"}}
    )


def test_sends_the_read_as_multipart_with_the_device_key():
    client, seen = client_for([ok()])
    assert client.send(READ)["status"] == "created"
    req = seen[0]
    assert req.headers["X-Device-Key"] == "vd_test"
    assert req.url.path == "/api/gate-events"
    body = req.content
    assert b'name="plate_text"' in body and b"UP16AB1234" in body
    assert b'name="captured_at"' in body and b"2026-11-25T08:00:00+00:00" in body
    assert b'name="snapshot"; filename="snapshot.jpg"' in body


def test_retries_network_errors_and_5xx_with_growing_backoff():
    sleeps: list[float] = []
    client, seen = client_for([httpx.ConnectError("down"), httpx.Response(503), ok()], sleeps)
    assert client.send(READ)["status"] == "created"
    assert len(seen) == 3
    assert sleeps == [0.5, 1.0]


def test_honours_retry_after_on_429():
    sleeps: list[float] = []
    client, _ = client_for(
        [httpx.Response(429, headers={"Retry-After": "7"}, json={"detail": "slow"}), ok()], sleeps
    )
    client.send(READ)
    assert sleeps == [7.0]


def test_gives_up_with_a_transient_error_after_max_retries():
    client, seen = client_for([httpx.ConnectError("down")] * 4)
    with pytest.raises(TransientError, match="network"):
        client.send(READ)
    assert len(seen) == 4  # first try + 3 retries


def test_4xx_is_permanent_and_not_retried():
    client, seen = client_for(
        [httpx.Response(422, json={"detail": "captured_at is too far in the future"})]
    )
    with pytest.raises(PermanentError) as err:
        client.send(READ)
    assert err.value.status == 422
    assert "future" in err.value.detail
    assert len(seen) == 1


def test_refuses_to_start_without_a_key():
    with pytest.raises(ValueError, match="webcam:devices"):
        GateClient("http://api.test", "")
