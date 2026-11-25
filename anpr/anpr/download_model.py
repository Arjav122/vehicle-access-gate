"""Fetch the plate detector (ONNX) at a pinned revision and verify its SHA-256.

    python -m anpr.download_model

The default detector is a third-party YOLO11 fine-tune published on Hugging Face under
AGPL-3.0 (docs/decisions.md D5, D17). We download it from its publisher at a fixed commit and
never re-host it. Weights are never committed to git.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from dataclasses import dataclass
from pathlib import Path

import httpx

from anpr.config import load_settings


@dataclass(frozen=True)
class ModelSource:
    url: str
    sha256: str
    size: int
    licence: str


# Hugging Face DavidDrill69/yolov11-license-plate-detection, commit f8fb9d5, the "nano" model.
DEFAULT_MODEL = ModelSource(
    url=(
        "https://huggingface.co/DavidDrill69/yolov11-license-plate-detection/resolve/"
        "f8fb9d5c258cf3db01cbe14272cc2da7b9a1e5e9/license-plate-finetune-v1n.onnx"
    ),
    sha256="693133a1db97a3ba1e90068986f80afb72c3fcddb681e57181a89a9a3dc351d6",
    size=10_481_682,
    licence="AGPL-3.0 (third-party model by DavidDrill69 on Hugging Face)",
)


class ChecksumError(RuntimeError):
    pass


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(source: ModelSource, dest: Path, client: httpx.Client | None = None) -> Path:
    """Download to `dest` (atomically, via a .part file) unless the right file is already there."""
    if dest.exists() and sha256_of(dest) == source.sha256:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    own_client = client is None
    http = client or httpx.Client(follow_redirects=True, timeout=60)
    try:
        with http.stream("GET", source.url) as response:
            response.raise_for_status()
            with part.open("wb") as f:
                for chunk in response.iter_bytes():
                    f.write(chunk)
    finally:
        if own_client:
            http.close()

    actual = sha256_of(part)
    if actual != source.sha256:
        part.unlink(missing_ok=True)
        raise ChecksumError(f"SHA-256 mismatch: expected {source.sha256}, got {actual}")
    part.replace(dest)
    return dest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dest", type=Path, default=None, help="where to save (default: settings)")
    args = parser.parse_args(argv)
    dest = args.dest or load_settings().detector_model

    print(f"Model licence: {DEFAULT_MODEL.licence}")
    print(f"Downloading {DEFAULT_MODEL.size / 1e6:.1f} MB to {dest} …")
    try:
        path = download(DEFAULT_MODEL, dest)
    except (httpx.HTTPError, ChecksumError) as err:
        print(f"Download failed: {err}", file=sys.stderr)
        return 1
    print(f"OK, SHA-256 verified: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
