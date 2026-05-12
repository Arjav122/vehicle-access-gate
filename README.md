# Vehicle access admin (monorepo)

Next.js admin UI and a FastAPI backend for vehicle and visitor access management. Shared configuration lives at the **repository root**; runnable apps live in **`frontend/`** and **`backend/`**.

---

## Repository layout

```
project1/
├── README.md                 ← this file (start here)
├── .env                      ← secrets (gitignored); copy from .env.example
├── .env.example              ← variable names and hints (safe to commit)
├── .gitignore
├── requirements.txt          ← Python dependencies for the API
├── frontend/                 ← Next.js 14 (App Router)
│   └── src/
│       ├── app/              ← pages and layouts
│       ├── components/       ← UI primitives + layout shell
│       ├── config/           ← e.g. API path prefix (`apiV1(...)`)
│       └── lib/              ← fetch helper, token storage, utils
└── backend/                  ← FastAPI + SQLAlchemy + Alembic
    ├── run.py                ← start API: loads repo-root `.env`
    ├── alembic.ini
    ├── alembic/              ← migrations (`versions/`)
    ├── scripts/              ← e.g. smoke_test.py
    └── app/
        ├── db/               ← database engine & session (see below)
        ├── models/           ← ORM tables (one file per domain)
        ├── api/v1/routes/    ← HTTP handlers (thin; call services)
        ├── services/         ← business logic (uses Session + models)
        │   └── anpr/         ← ANPR: HF YOLO11 plate detector + EasyOCR pipeline
        ├── schemas/          ← Pydantic request/response models
        ├── agents/           ← LangGraph-style workflows
        ├── config.py         ← settings from environment
        └── main.py           ← FastAPI app, CORS, lifespan
```

---

## Prerequisites

| Component | Notes |
|-----------|--------|
| Node.js 18+ | For `frontend/` (`npm`). |
| Python 3.11+ | For `backend/`. |
| PostgreSQL | Local Postgres or hosted (e.g. Supabase). `DATABASE_URL` must be reachable from the machine running the API. |

---

## Environment variables

All variables are documented in **`.env.example`** at the repo root. Copy to **`.env`** and fill in:

- **`DATABASE_URL`** — SQLAlchemy URL; `postgresql+psycopg2://...` is normalized automatically. For Supabase hosts, `sslmode=require` is appended when missing.
- **`JWT_SECRET_KEY`**, **`ADMIN_EMAIL`**, **`ADMIN_PASSWORD`** — required for auth and first-run admin bootstrap.
- **`OPENAI_API_KEY`**, email fields — optional depending on features you use.
- **`API_PORT`** — FastAPI bind port (`backend/run.py`); Next.js rewrites same-origin `/api/*` to `http://127.0.0.1:${API_PORT}` so login cannot silently hit the wrong port.
- **`NEXT_PUBLIC_API_URL`** — leave empty in dev for same-origin `/api` → rewrite → FastAPI. Set only if the browser must call the API on another origin.
- **`BACKEND_INTERNAL_URL`** — optional (e.g. Docker `http://api:8000`). On `localhost` / `127.0.0.1`, a port that disagrees with **`API_PORT`** is overridden with a console warning.

Next.js reads the same root `.env` via `frontend/next.config.mjs` (`envDir`).

---

## Database layer (backend)

| Path | Role |
|------|------|
| `app/db/base.py` | SQLAlchemy `declarative_base()` (`Base`). |
| `app/db/session.py` | `engine`, `SessionLocal`, `get_db()` dependency. |
| `app/db/__init__.py` | Re-exports `Base`, `engine`, `SessionLocal`, `get_db`. |
| `app/models/enums.py` | Shared DB enums (`LogEventType`, `VisitorStatus`, `AlertSeverity`). |
| `app/models/*.py` | One ORM module per table group (`admin`, `resident`, `vehicle`, `visitor`, `access_log`, `alert`, `setting`). |
| `app/models/__init__.py` | Public exports for `from app.models import ...`. |

**Alembic** (`backend/alembic/`) uses `Base.metadata` from `app.db.base` and imports `app.models` so every table is registered before migrations run.

**Do not** commit `.env` or database credentials. `.gitignore` already excludes `.env` and `backend/.venv/`.

### Gate workflow

- **Gate camera** (`/live`): start camera on demand, ANPR scan, registered vehicle entry/exit with resident context, unknown plate opens visitor kiosk form.
- **Pending visitors** (`POST /api/v1/visitors/gate-request`): creates `pending_approval` visitor, `registration` access log, and an alert for admins.
- **Approvals** (`/approvals`, `GET/PATCH /api/v1/visitors/...`): admins approve or reject; approved visitors become `active` with a new pass code and fresh validity window.

### ANPR (license plates)

- **Detector:** `app/services/anpr/detector.py` loads **`DavidDrill69/yolov11-license-plate-detection`** / `license-plate-finetune-v1n.pt` from the Hugging Face Hub (cached on disk). Override with `PLATE_DETECTOR_REPO` / `PLATE_DETECTOR_WEIGHTS`; tune confidence with `PLATE_DETECTION_CONF` (default `0.25`).
- **OCR:** `app/services/anpr/ocr_engine.py` — grayscale, bilateral filter, CLAHE, unsharp mask, upscale; **EasyOCR** with alphanumeric allowlist and Indian-style plate pattern scoring.
- **API:** `POST /api/v1/detection/analyze` returns `PlateDetectionResult` (plate text, OCR confidence, detector confidence, box count, preprocessing note, candidates).
- **Windows HF cache:** you may see a Hugging Face symlink warning; set `HF_HUB_DISABLE_SYMLINKS_WARNING=1` or enable Developer Mode if you want symlinked caches.

---

## Setup

### 1. Root environment

```powershell
cd <repo-root>
copy .env.example .env
# Edit .env: DATABASE_URL, JWT_SECRET_KEY, ADMIN_*, etc.
```

### 2. Backend (virtualenv + deps)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r ..\requirements.txt
```

### 3. Migrations

From `backend/` with `DATABASE_URL` set in the repo-root `.env`:

```powershell
alembic upgrade head
```

On first API start, migrations and admin bootstrap may also run automatically unless you set **`RUN_STARTUP_DB_SETUP=false`** in `.env`.

### 4. Frontend

```powershell
cd frontend
npm install
```

`next.config.mjs` loads the **repo-root** `.env` via **`dotenv`** (Next 14.2 does not support the `envDir` config key).

---

## Run locally

| Service | Command | URL |
|---------|---------|-----|
| API | From `backend/`: `python run.py` | `http://127.0.0.1:8000` (see `API_PORT` in `.env`) — OpenAPI: `/docs` |
| UI | From `frontend/`: `npm run dev` | `http://localhost:3000` |

In development, the UI calls same-origin `/api/...`; Next.js rewrites those requests to the backend (see `frontend/next.config.mjs`), which avoids CORS issues.

---

## Conventions

- **HTTP:** versioned JSON under `/api/v1`. Frontend builds paths with `src/config/api.ts` (`apiV1("/…")`).
- **Backend:** routes stay thin; services own transactions and rules; schemas validate I/O; models are persistence only.
- **Windows:** `run.py` disables Uvicorn reload by default; set `UVICORN_RELOAD=1` if you want hot reload anyway.

---

## Smoke test

From `backend/` with the venv activated:

```powershell
python scripts\smoke_test.py
```

Checks DB connectivity, `GET /health`, and admin login using settings from the repo-root `.env`.

---

## Troubleshooting

- **503 database errors from the API** — Confirm Postgres is up, `DATABASE_URL` is correct, and firewalls/VPN allow the connection. Prefer the Supabase **pooler** URL if the direct host fails.
- **Schema errors** — Run `alembic upgrade head` with the same `DATABASE_URL` the API uses.
- **Frontend “Failed to fetch”** — Ensure the API is running; in dev, prefer empty `NEXT_PUBLIC_API_URL` so requests go through the Next proxy.
