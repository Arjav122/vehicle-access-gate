"""Smoke test: DB URL resolution, /health, and admin login. Run from backend: python scripts/smoke_test.py (uses repo root .env)."""

from __future__ import annotations

import sys
from pathlib import Path

_backend = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_backend))

from fastapi.testclient import TestClient  # noqa: E402


def main() -> int:
    from urllib.parse import urlparse

    from app.config import get_settings

    s = get_settings()
    host = urlparse(s.database_url.replace("postgresql+psycopg2://", "postgresql://")).hostname
    print("Resolved DB host:", host)
    if host in ("127.0.0.1", "localhost"):
        print(
            "WARN: DATABASE_URL points to localhost. If that is unintended, remove a global "
            "DATABASE_URL from your environment — repo root .env should define Supabase."
        )

    from app.main import app

    with TestClient(app) as client:
        h = client.get("/health")
        print("GET /health", h.status_code, h.json())
        if h.status_code != 200:
            return 1

        r = client.post(
            "/api/v1/auth/login",
            json={"email": s.admin_email, "password": s.admin_password},
        )
        print("POST /api/v1/auth/login", r.status_code)
        if r.status_code == 200:
            data = r.json()
            print("  token_type:", data.get("token_type"), "access_token len:", len(data.get("access_token", "")))
            return 0
        body = (r.text or "")[:800]
        print("  body:", body.encode("ascii", errors="replace").decode("ascii"))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
