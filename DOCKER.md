# Docker setup

Docker for this monorepo **without changing application code or dependencies**.

The frontend container runs `npm run dev` (same as local dev). A production `next build` image is possible later once existing TypeScript build checks pass.

## Architecture

```text
Browser → web:3000 (Next.js)
              └─ /api/* rewrite → api:8000 (FastAPI)
                                    └─ Supabase Postgres (external)
```

- **api** — FastAPI backend (`backend/run.py`)
- **web** — Next.js frontend (`npm start`)
- **Database** — your existing Supabase `DATABASE_URL` (not containerized)

## Prerequisites

- Docker Desktop (WSL2 enabled on Windows)
- Repo-root `.env` filled in (copy from `.env.example`)
- Internet access (Supabase + optional ANPR model downloads)

## Quick start

From the repository root:

```bash
docker compose up --build -d
```

Open:

- Frontend login: http://localhost:3000/login
- Backend health: http://localhost:8000/health
- API docs: http://localhost:8000/docs

Stop:

```bash
docker compose down
```

## Required `.env` values

Same as local dev:

- `DATABASE_URL`
- `JWT_SECRET_KEY`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Docker networking (set in `docker-compose.yml`; optional overrides in `.env`):

- `BACKEND_INTERNAL_URL=http://api:8000` — Next.js server proxies `/api/*` to the backend service
- `API_PORT=8000`
- `NEXT_PUBLIC_API_URL=` (empty — browser uses same-origin `/api`)

## Model caches (ANPR)

Named volumes persist downloads across container restarts:

- Hugging Face YOLO weights → `model_cache_hf`
- PaddleOCR → `model_cache_paddle`
- EasyOCR → `model_cache_easyocr`

First plate-detection request may be slow while models download.

## Useful commands

```bash
# Follow logs
docker compose logs -f api web

# Rebuild after dependency changes (rare — requirements.txt is copied into image)
docker compose build --no-cache api

# Check health
docker compose ps
curl http://localhost:8000/health
```

## Ports

| Service | Container port | Host default |
|---------|----------------|--------------|
| web     | 3000           | 3000 (`WEB_PORT`) |
| api     | 8000           | 8000 (`API_PORT`) |

## Notes

- **Do not** run local `python run.py` / `npm run dev` on the same ports while Compose is up.
- Secrets stay in `.env`; they are **not** copied into images (see `.dockerignore`).
- Project code and `requirements.txt` / `package.json` are unchanged; only Docker files were added.
- First `docker compose build api` can take **15–30+ minutes** (torch / paddle / vision stack).
- `UVICORN_RELOAD=0` is set in Compose so Linux containers do not spawn a hot-reload subprocess.
- If login returns a database error inside Docker, re-copy the latest **Supabase pooler URI** into repo-root `.env` and run `docker compose up -d --force-recreate api`.
