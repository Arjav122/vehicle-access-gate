"""Run API: `python run.py` from the `backend` folder (loads repo-root `.env`)."""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
import uvicorn

_backend_root = Path(__file__).resolve().parent
_project_root = _backend_root.parent
_env = _project_root / ".env"
if _env.is_file():
    load_dotenv(_env, override=True)

if __name__ == "__main__":
    # On Windows, --reload can crash the worker (asyncio/WatchFiles subprocess quirks).
    # Default: no reload on win32. Set UVICORN_RELOAD=1 to enable hot reload anyway.
    _port = int(
        os.environ.get("API_PORT", os.environ.get("PORT", "8000")).strip() or "8000"
    )
    _want_reload = os.environ.get("UVICORN_RELOAD", "").strip().lower() in ("1", "true", "yes")
    if sys.platform == "win32" and not _want_reload:
        uvicorn.run("app.main:app", host="0.0.0.0", port=_port, reload=False)
    else:
        uvicorn.run(
            "app.main:app",
            host="0.0.0.0",
            port=_port,
            reload=True,
            reload_dirs=[str(_backend_root / "app")],
        )
