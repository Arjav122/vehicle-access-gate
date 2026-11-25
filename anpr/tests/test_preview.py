"""Preview page: localhost-only, Host check, custom-header actions, CSP, words for decisions."""

import csv
import http.client
import json
import threading
from datetime import UTC, datetime

import numpy as np
import pytest

from anpr.pipeline import Delivery
from anpr.preview import explain, make_server, save_labelled
from anpr.tracker import Read


class FakeWorker:
    def __init__(self):
        self.actions: list[tuple[str, str | None]] = []

    def state(self):
        return {"direction": "entry", "plate": "UP16AB1234"}

    def latest_jpeg(self):
        return b"\xff\xd8\xffjpeg"

    def act(self, action, plate):
        self.actions.append((action, plate))
        return {"direction": action if action in ("entry", "exit") else "entry"}


@pytest.fixture
def server():
    worker = FakeWorker()
    srv = make_server(worker, 0)
    port = srv.server_address[1]
    # Rebuild with the real port so the Host check knows it.
    srv.server_close()
    srv = make_server(worker, port)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv, worker, port
    srv.shutdown()
    srv.server_close()


def request(port, method, path, host=None, headers=None, body=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    h = {"Host": host or f"127.0.0.1:{port}", **(headers or {})}
    conn.request(method, path, body=body, headers=h)
    res = conn.getresponse()
    data = res.read()
    conn.close()
    return res, data


def test_binds_to_localhost_only(server):
    srv, _, _ = server
    assert srv.server_address[0] == "127.0.0.1"


def test_page_has_strict_csp_with_a_fresh_nonce(server):
    _, _, port = server
    res, body = request(port, "GET", "/")
    assert res.status == 200
    csp = res.getheader("Content-Security-Policy")
    assert "frame-ancestors 'none'" in csp
    nonce = csp.split("'nonce-")[1].split("'")[0]
    assert f'nonce="{nonce}"'.encode() in body
    _, body2 = request(port, "GET", "/")
    assert nonce.encode() not in body2  # a new nonce per response


def test_rejects_other_host_headers(server):
    _, _, port = server
    res, _ = request(port, "GET", "/state.json", host="evil.example:8765")
    assert res.status == 403


def test_actions_need_the_custom_header_and_json(server):
    _, worker, port = server
    body = json.dumps({"action": "exit"})
    no_header, _ = request(
        port, "POST", "/action", headers={"Content-Type": "application/json"}, body=body
    )
    form, _ = request(
        port,
        "POST",
        "/action",
        headers={"Content-Type": "text/plain", "X-Preview-Action": "1"},
        body=body,
    )
    assert (no_header.status, form.status) == (403, 415)
    assert worker.actions == []

    ok, data = request(
        port,
        "POST",
        "/action",
        headers={"Content-Type": "application/json", "X-Preview-Action": "1"},
        body=body,
    )
    assert ok.status == 200 and json.loads(data)["direction"] == "exit"
    assert worker.actions == [("exit", None)]


def test_unknown_actions_are_refused(server):
    _, worker, port = server
    res, _ = request(
        port,
        "POST",
        "/action",
        headers={"Content-Type": "application/json", "X-Preview-Action": "1"},
        body=json.dumps({"action": "rm -rf"}),
    )
    assert res.status == 400 and worker.actions == []


def answer(match: str, status: str = "created", vehicle=None) -> dict:
    return {"status": status, "event": {"id": "e1", "matchResult": match, "vehicle": vehicle}}


def delivery(**kw) -> Delivery:
    return Delivery(read=Read("UP16AB1234", 0.9, datetime.now(UTC)), direction="entry", **kw)


@pytest.mark.parametrize(
    ("kw", "tone", "words"),
    [
        (
            {"answer": answer("resident", vehicle={"flatLabel": "B-402"})},
            "ok",
            "Resident car (flat B-402): entry logged",
        ),
        ({"answer": answer("unknown")}, "info", "New car: register the visitor"),
        ({"answer": answer("watchlist")}, "error", "Watchlist plate"),
        ({"answer": answer("low_confidence")}, "warn", "guard will check"),
        ({"answer": answer("resident", status="debounced")}, "ok", "already seen: debounced"),
        ({"queued": True}, "warn", "Server offline"),
        ({"rejected": "422: bad"}, "error", "rejected"),
    ],
)
def test_decisions_are_explained_in_words(kw, tone, words):
    out = explain(delivery(**kw))
    assert out["tone"] == tone and words in out["text"]


def test_save_for_testing_writes_the_frame_and_a_labels_row(tmp_path):
    save_labelled(np.zeros((10, 10, 3), np.uint8), " up16ab1234 ", folder=tmp_path)
    save_labelled(np.zeros((10, 10, 3), np.uint8), "KA05MN0042", folder=tmp_path)
    rows = list(csv.reader((tmp_path / "labels.csv").open()))
    assert rows[0] == ["filename", "plate"]
    assert [r[1] for r in rows[1:]] == ["UP16AB1234", "KA05MN0042"]
    assert all((tmp_path / r[0]).exists() for r in rows[1:])
