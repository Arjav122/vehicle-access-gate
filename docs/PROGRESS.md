# Progress

The brief is in [`CLAUDE.md`](../CLAUDE.md). Update this file at the start and end of every session.

| Phase | Name | Branch | Status | PR |
|---|---|---|---|---|
| 0 | Safety, cleanup, foundation | `phase-0-foundation` | 🟢 PR open, CI green; waiting for owner review + merge | [#1](https://github.com/Arjav122/vehicle-access-gate/pull/1) |
| 1 | Server core, database, auth | `phase-1-server-core` | 🟢 PR open (stacked on #1), CI green; waiting for owner review + merge | [#2](https://github.com/Arjav122/vehicle-access-gate/pull/2) |
| 2 | Gate event engine | `phase-2-gate-events` | 🟢 PR open (stacked on #2), CI green; waiting for owner review + merge | [#3](https://github.com/Arjav122/vehicle-access-gate/pull/3) |
| 3 | ANPR worker | `phase-3-anpr-worker` | 🟢 PR open (stacked on #3), CI green; webcam test passed; waiting for merge | [#4](https://github.com/Arjav122/vehicle-access-gate/pull/4) |
| 4 | Visitors, approvals, guest passes, real time | `phase-4-visitors-approvals` | ⚪ Not started | — |
| 5 | Escalation, notifications, scheduled jobs | `phase-5-escalation-jobs` | ⚪ Not started | — |
| 6 | Frontend | `phase-6-frontend` | ⚪ Not started | — |
| 7 | Simulator, hardening, end-to-end tests | `phase-7-simulator-hardening` | ⚪ Not started | — |
| 8 | Docker and deployment | `phase-8-deployment` | ⚪ Not started | — |
| 9 | Polish, docs, release | `phase-9-release` | ⚪ Not started | — |

## Phase 0 — Safety, cleanup, foundation

### Step 1: Safety
- [x] Summarise `git status` (26 uncommitted WIP changes, untracked `backend/_run_no_migrate.py` and `docs/`)
- [x] Tag `HEAD` (`a5e377b`) as `v1-original`. Local only, not pushed yet.
- [x] Create branch `phase-0-foundation`
- [x] Save the brief as `CLAUDE.md`
- [x] Write this plan

### Step 2: Inventory
- [x] Owner approved the KEEP / MOVE / DELETE list ("Approve all", 2026-11-25)
- [x] WIP cleanup: discarded (superseded by deleting v1)
- [x] Detector weights: pin the third-party HF model now, train our own for `models-v1` (D5)
- [x] Default branch: renamed `master` → `main` locally (D4)

### Step 3: Apply and build the foundation
- [x] Move the academic report to `Desktop\capstone-report\` (outside the repo)
- [x] Apply the DELETE list (v1 stays readable via the `v1-original` tag)
- [x] Check current stable versions (D6)
- [x] Create the §7 skeleton: `server/`, `client/`, `anpr/`, `docs/` with placeholder entry points and one test each
- [x] Add `LICENSE` (MIT), `.gitignore`, `.editorconfig`, `.gitleaks.toml`, `.env.example`
- [x] Add the dev `docker-compose.yml`: postgres, mailpit, placeholder server and client
- [x] Add `.github/workflows/ci.yml`: server, client, anpr, compose smoke test, gitleaks
- [x] Add `.github/pull_request_template.md`
- [x] Write the README skeleton (no invented numbers)
- [x] Write `docs/decisions.md` D1–D7
- [x] Write `docs/learn/phase-0.md`
- [x] Verify locally: server and client lint, format, typecheck, tests (+ client build); anpr ruff + pytest on Python 3.12; API and Vite proxy answer `/api/health`
- [x] Verify: `docker compose up --build --wait` starts all four services healthy; API, Vite proxy, web page and Mailpit answer (Postgres 17.12)
- [x] Fix: client container could not write Vite's temp config as the non-root user, and had no healthcheck so compose still said "healthy". Both Dockerfiles now give `/app` to `node`; the client has a healthcheck, so `--wait` and the CI smoke test catch it
- [x] Verify: gitleaks over the full history: 6 commits, no leaks. (The working-tree scan flags only the gitignored local `.env`, never committed.)
- [x] Live reload of `server/src` edits through the Docker bind mount on Windows: fixed and verified in Phase 1 (polling)
- [ ] Owner: confirm the Supabase Postgres major version (D3)
- [x] Pushed `main`, `phase-0-foundation` and tag `v1-original`; opened [PR #1](https://github.com/Arjav122/vehicle-access-gate/pull/1); all 5 CI jobs green (server, client, anpr, compose smoke test, gitleaks)
- [ ] Owner: switch the GitHub default branch to `main` and delete `master` on GitHub
- [ ] Owner: review and merge PR #1

## Phase 1 — Server core, database, auth

Branch `phase-1-server-core`, stacked on `phase-0-foundation` (retarget to `main` once PR #1 merges).

- [x] Versions checked (Prisma 7.10.1 stable; `latest` tag is an 8.0 release candidate) (D8)
- [x] `config.ts`: env parsed with Zod; refuses the default JWT secret in production
- [x] `db.ts`: Prisma client (pg driver adapter), transaction helper, constraint → 409 helper
- [x] `middleware.ts`: request id, pino logging, helmet, CORS allow-list, body limits, auth, device auth, `requireRoles`, validation, errors
- [x] `/api/health`, `/api/ready` (503 when Postgres is down)
- [x] Full Prisma schema (21 tables) + first migration with 22 CHECK constraints and partial indexes (review queue, one primary contact per flat)
- [x] `docs/database.md`: Mermaid ER diagram + one line per table
- [x] Auth (§10.7): login (argon2id, dummy-hash timing guard, per-IP and per-account limits), refresh rotation with reuse detection, logout, `GET /me`
- [x] CRUD with pagination/filters + audit log: flats, residents, vehicles, guards, gates, devices (+ rotate key, `GET /devices/me`), watchlist; `GET /audit-logs`
- [x] Plate cleaning + Indian format validation for vehicles/watchlist (full repair + fuzzy match in Phase 2)
- [x] OpenAPI 3.1 from Zod + Swagger UI at `/api/docs` (44 endpoints)
- [x] Seed script (`npm run seed`, fixed random seed, `--reset`, refuses non-local DBs): 40 flats, 60 residents, 81 vehicles, 3 guards, 2 gates × 2 cameras, 3 watchlist plates
- [x] Tests against a real Postgres test DB: 265 tests, every role on every route; `services/` line coverage 98.7% (threshold 80%)
- [x] CI: server job gets a Postgres service container; compose smoke test seeds and signs in as each demo role
- [x] Docker dev: migrations applied on start; live reload works on Windows (polling; Phase 0 open item closed)
- [x] `docs/decisions.md` (D8–D13), `docs/learn/phase-1.md`, PROGRESS updated
- [x] Opened [PR #2](https://github.com/Arjav122/vehicle-access-gate/pull/2) (base `phase-0-foundation`); all 5 CI jobs green after one fix (Prettier was checking the generated Prisma client; fixed with `server/.prettierignore`)
- [ ] Owner: merge #1, then #2 (base switched to `main` first)

## Phase 2 — Gate event engine

Branch `phase-2-gate-events`, stacked on `phase-1-server-core` (retarget to `main` once #1 and #2 merge).

- [x] Plate repair (look-alike swaps by position, IND mark, shape penalties, max 3 swaps) + fuzzy matching (Levenshtein ≤ 1, length pre-filter in SQL, ambiguous → review): **84 plate tests** (D14)
- [x] Pure visit state machine: 8 statuses × 7 triggers, 10 legal moves; **all 56 pairs tested**
- [x] `transitionVisit` is the only writer of visit status: row lock, enteredAt/expectedExitAt (category limit or agreed duration), exitedAt/duration, history row in the same transaction, exit resolves open escalation tasks
- [x] `POST /api/gate-events` (camera key, multipart): idempotency (event hash) + two-sided 30 s debounce under an advisory lock; future-time, lane and confidence checks; per-device rate limit (D16)
- [x] Matching order: watchlist (even low confidence) → low confidence / unreadable → resident vehicle / expected visitor at that lane → unknown
- [x] Resident entry/exit pairing (`FOR UPDATE`, unique pairing); expected visitors move inside / exit
- [x] Watchlist alerts (critical) + `GET /alerts`, idempotent `POST /alerts/:id/acknowledge`
- [x] Review queue + `POST /gate-events/:id/review` (correct re-runs matching and stores the correction as labelled data, or dismiss; once)
- [x] Snapshots: local storage, magic-byte check, 2 MB limit (413), retry's file deleted, `GET /gate-events/:id/snapshot`; S3 moved to Phase 8 (D15)
- [x] `GET /gate-events` with filters + CSV export (formula-safe cells)
- [x] Bugs found while building, each with a test: one-sided debounce window merged replayed old reads; a visit changing state mid-read could have rejected a car
- [x] Tests: **436 passing**; `services/` coverage 96.8% lines / 86.3% branches
- [x] Docker: snapshot volume; real camera upload against the seeded stack (resident matched to A-202 with snapshot, retry → duplicate, watchlist → alert + review)
- [x] Docs: decisions D14–D16, `docs/learn/phase-2.md`
- [x] Opened [PR #3](https://github.com/Arjav122/vehicle-access-gate/pull/3) (base `phase-1-server-core`); all 5 CI jobs green on the first run
- [ ] Owner: merge #1 → #2 → #3

## Phase 3 — ANPR edge worker

Branch `phase-3-anpr-worker`, stacked on `phase-2-gate-events`.

- [x] Detector: the publisher's pinned ONNX (`f8fb9d5`, SHA-256 checked, AGPL-3.0, not re-hosted); letterbox + `(1,5,N)` decode + NMS in NumPy; no PyTorch/Ultralytics anywhere (D17)
- [x] OCR: PaddleOCR mobile models with oneDNN off (Windows crash workaround); pieces read rows top→bottom, left→right; IND line dropped; optional `[ocr]` extra (D18)
- [x] Tracker: reads within 2 edits = one car; vote by summed confidence; send after 3 agreeing reads or a 2 s gap; once per car
- [x] Client (retries, backoff, Retry-After, 4xx permanent) + SQLite offline buffer per lane (WAL, synchronous=FULL, oldest-first replay, rejected table) (D19)
- [x] Sources: webcam (DirectShow on Windows), RTSP/HTTP, video (video-time clock), image folder; CLI flags `--source --direction --dry-run --preview --start -v`
- [x] Webcam preview page: 3 threads, MJPEG, decisions in words, Entry/Exit/Scan again (E/X/Space), Register this visitor link, Save for testing; localhost-only, Host check, custom-header actions, nonce CSP, `frame-ancestors 'none'`
- [x] `npm run webcam:devices` (server): gate "Laptop webcam" + entry/exit devices, rotated keys written to `anpr/.env`
- [x] `eval/evaluate.py` + `DATASET.md` + notebooks (`train_detector`, `compare_ocr`); **no accuracy numbers yet** (no labelled real photos)
- [x] Bugs found with real OCR, fixed with regression tests: oneDNN crash; split pieces read out of order (`123422BHA`)
- [x] Tests: anpr **66 passing** (real detector on synthetic plates included); server webcam-script tests
- [x] End to end, real detector + real OCR → running server: resident plate matched to its flat, unknown → unknown, watchlist → alert
- [x] **Owner:** ran the webcam demo with a real plate on the laptop: plates detected and read correctly (2026-11-25)
- [ ] **Owner (for real numbers):** collect labelled photos (`anpr/DATASET.md`), then `python eval/evaluate.py --data …`
- [ ] Deferred: `anpr/Dockerfile` with the production images in Phase 8
- [x] Opened [PR #4](https://github.com/Arjav122/vehicle-access-gate/pull/4) (base `phase-2-gate-events`); all 5 CI jobs green, including real-detector tests with the model downloaded and hash-checked in CI
