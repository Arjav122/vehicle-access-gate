# Vehicle Access

[![CI](https://github.com/Arjav122/vehicle-access-gate/actions/workflows/ci.yml/badge.svg)](https://github.com/Arjav122/vehicle-access-gate/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 🚧 **v2 rebuild in progress.** This README is a skeleton; sections fill in as each phase lands.
> Progress: [`docs/PROGRESS.md`](docs/PROGRESS.md). The previous FastAPI + Next.js version is tagged `v1-original`.

<!-- Demo GIF recorded from the running app goes here (Phase 9). -->

**AI-powered gate and visitor management for Indian housing societies:** a camera reads number
plates so residents drive in without stopping, visitors are approved by the resident on their
phone in real time, and vehicles that stay too long are followed up automatically.

**Live demo:** not deployed yet (Phase 8).

## What it does

- Reads Indian number plates (standard and BH series) at entry and exit lanes and logs residents automatically
- Unknown vehicle → guard registers the visitor → resident approves or denies in real time; no answer in 3 minutes → the guard decides
- Guest passes by plate or one-time code
- Time limits per visit type, with an escalation ladder (email → reminder → "call the resident" task)
- Watchlist alerts, a review queue for unclear reads, analytics, nightly reconciliation, privacy controls

## Engineering highlights

_Filled in as features land (Phases 1–7)._

## Architecture

```
Camera → ANPR worker (Python, ONNX YOLO + OCR, frame voting, offline buffer)
       → Node API (Express, Prisma/PostgreSQL, Socket.io, node-cron)
       → React app (guard console, resident app, admin dashboard)
```

A full diagram arrives in `docs/architecture.md`.

## Results

| Metric | Value |
|---|---|
| Plate detection mAP | TBD (measured in Phase 3) |
| End-to-end exact-plate accuracy | TBD (measured in Phase 3) |
| Detector CPU latency (ONNX) | TBD (measured in Phase 3) |

Every number here will come from a reproducible run in `anpr/eval/`.

## Tech stack

Node.js + TypeScript + Express · PostgreSQL + Prisma (Supabase in production) · Socket.io ·
React + Vite + Tailwind · Python 3.12 + ONNX Runtime + PaddleOCR · Docker · GitHub Actions

## Quick start

Requirements: Docker Desktop, Node.js 24+ (26 LTS recommended), Python 3.12 (or [uv](https://docs.astral.sh/uv/)).

```powershell
Copy-Item .env.example .env
docker compose up --build
```

| Service | URL |
|---|---|
| Web app (Vite) | http://127.0.0.1:5173 |
| API health | http://127.0.0.1:4000/api/health |
| Mailpit inbox | http://127.0.0.1:8025 |

## Project structure

```
server/   Node API (Express, Prisma, Socket.io, jobs)
client/   React web app
anpr/     Python edge worker (camera → plate reads)
docs/     progress, decisions, architecture, study guides
```

## Design decisions

See [`docs/decisions.md`](docs/decisions.md).

## Testing

Each package runs its own checks; CI runs all of them on every pull request.

```powershell
cd server; npm ci; npm run lint; npm run typecheck; npm test
```

```powershell
cd client; npm ci; npm run lint; npm run typecheck; npm test
```

```powershell
cd anpr; uvx ruff check .; uv run --no-project --python 3.12 --with pytest python -m pytest
```

## Known limitations

_Documented as they are found._

## Future work

Multi-society tenancy, SMS/voice providers, native mobile apps, face recognition, payments,
tailgating detection.

## License

[MIT](LICENSE)

## Author

Arjav Jain
