"""Model download: hash checked, atomic, skipped when already present."""

import hashlib

import httpx
import pytest

from anpr.download_model import DEFAULT_MODEL, ChecksumError, ModelSource, download


def source_for(content: bytes) -> ModelSource:
    return ModelSource(
        url="https://models.test/m.onnx",
        sha256=hashlib.sha256(content).hexdigest(),
        size=len(content),
        licence="test",
    )


def client_serving(content: bytes, calls: list[int]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200, content=content)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_downloads_and_verifies(tmp_path):
    calls: list[int] = []
    dest = download(
        source_for(b"model-bytes"), tmp_path / "m.onnx", client_serving(b"model-bytes", calls)
    )
    assert dest.read_bytes() == b"model-bytes"
    assert not (tmp_path / "m.onnx.part").exists()


def test_rejects_a_file_with_the_wrong_hash_and_leaves_nothing(tmp_path):
    src = source_for(b"expected")
    with pytest.raises(ChecksumError):
        download(src, tmp_path / "m.onnx", client_serving(b"tampered", []))
    assert list(tmp_path.iterdir()) == []


def test_skips_the_download_when_the_right_file_is_there(tmp_path):
    (tmp_path / "m.onnx").write_bytes(b"model-bytes")
    calls: list[int] = []
    download(source_for(b"model-bytes"), tmp_path / "m.onnx", client_serving(b"x", calls))
    assert calls == []


def test_default_model_is_pinned_to_a_commit_and_hash():
    assert "/resolve/f8fb9d5c258cf3db01cbe14272cc2da7b9a1e5e9/" in DEFAULT_MODEL.url
    assert len(DEFAULT_MODEL.sha256) == 64
    assert "AGPL" in DEFAULT_MODEL.licence
