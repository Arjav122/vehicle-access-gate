# Progress

The brief is in [`CLAUDE.md`](../CLAUDE.md). Update this file at the start and end of every session.

| Phase | Name | Branch | Status | PR |
|---|---|---|---|---|
| 0 | Safety, cleanup, foundation | `phase-0-foundation` | ✅ Merged into `main` | [#1](https://github.com/Arjav122/vehicle-access-gate/pull/1) |
| 1 | Server core, database, auth | `phase-1-server-core` | ✅ Merged into `main` | [#2](https://github.com/Arjav122/vehicle-access-gate/pull/2) |
| 2 | Gate event engine | `phase-2-gate-events` | ✅ Merged into `main` | [#3](https://github.com/Arjav122/vehicle-access-gate/pull/3) |
| 3 | ANPR worker | `phase-3-anpr-worker` | ✅ Merged into `main` | [#4](https://github.com/Arjav122/vehicle-access-gate/pull/4) |
| 4 | Visitors, approvals, guest passes, real time | `phase-4-visitors-approvals` | ✅ Merged into `main` | [#5](https://github.com/Arjav122/vehicle-access-gate/pull/5) |
| 5 | Escalation, notifications, scheduled jobs | `phase-5-escalation-jobs` | ✅ Merged into `main` | [#6](https://github.com/Arjav122/vehicle-access-gate/pull/6) |
| 6 | Frontend | `phase-6-frontend` | 🟡 In progress | — |
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

## Phase 4 — Visitors, approvals, guest passes, real time

Branch `phase-4-visitors-approvals`, from `main`.

- [x] Visitor registration `POST /visits` (categories, optional waiting-car read; registering the same car twice → 409)
- [x] Approvals: locked row, first answer wins, same answer 200 / different 409; clock checked on every answer; 15 s `approvals.expire` job; guard fallback `POST /visits/:id/decision` only after the timeout (D20)
- [x] Approving a registered waiting car lets it in at once; otherwise the visit waits as approved for a camera read or `POST /visits/:id/enter`
- [x] `GET /visits` (phones masked; residents see their own flats), `GET /visits/:id`, manual `enter` / `exit`; `GET /approvals`, `POST /approvals/:id/decision`
- [x] Guest passes: create (code shown once, HMAC stored), revoke, list, redeem by code; plate match at the entry camera admits the car; uses counted with a conditional UPDATE (D21)
- [x] Settings `GET/PATCH /settings` (audited); limits and timeout used everywhere through `effectiveSettings`
- [x] Socket.io real time: token auth, rooms `staff` / `user:<id>`, events published after commit: `gate_event.created`, `alert.created`, `approval.requested/decided/timed_out`, `visit.updated` (D22)
- [x] Tests: **523 passing** (15 new Phase 4 scenarios with real Socket.io clients: the full unknown-visitor path, double-tap race, timeout + guard, guest passes, settings, masking, socket auth); `services/` coverage 96.4% lines
- [x] Docker: rebuilt; jobs start; `/socket.io` answers directly and through the Vite proxy
- [ ] Deferred: Telegram approvals (stretch); visitor email → Phase 5 notifications
- [x] [PR #5](https://github.com/Arjav122/vehicle-access-gate/pull/5) opened, CI green, merged into `main`

## Phase 5 — Escalation, notifications, scheduled jobs

Branch `phase-5-escalation-jobs`, from `main`.

- [x] Notification outbox: `queueEmail` (idempotency key, `ON CONFLICT DO NOTHING`), HTML + text templates (escaped, IST times), Nodemailer SMTP (Mailpit in dev) (D23)
- [x] Dispatcher: `FOR UPDATE SKIP LOCKED`, backoff 1, 2, 4 … 60 min, `failed` after 5 attempts with the last error
- [x] Escalation ladder: pure `dueSteps` + `runLadder(now)`: overstay emails at the limit, reminder +30 min, call-the-resident task +60 min; any exit resolves the task `vehicle_left` (D24)
- [x] `GET /escalations` (full resident phones), `POST /escalations/:id/resolve` (once; `escalation.created` / `escalation.resolved` events)
- [x] Reconciliation (exits without entries, entries never closed, stale visits; flagged once) + `GET /reconciliation`, `POST /reconciliation/:id/resolve`; delivery log `GET /notifications` (D25)
- [x] Retention: visitor data erased past the retention period (not while a visit is open), old emails redacted, old snapshots deleted
- [x] "Visit approved" email to the visitor
- [x] `jobs.ts`: approvals.expire 15 s, escalation.tick and notifications.dispatch every minute, reconciliation 03:00 IST, retention 03:30 IST (`RUN_JOBS=true`)
- [x] Tests: **573 passing**, 25 of them new in Phase 5 with a mocked clock (every ladder step exactly once, outage catch-up, racing runs, retries/backoff, racing dispatchers, reconciliation, retention, APIs); `services/` coverage 96.6% lines, 86.8% branches
- [x] Docker: rebuilt; all five jobs start; a real "visit approved" email (HTML + text) arrived in Mailpit through the dispatcher
- [ ] Deferred: `demo.nightlyReset` → Phase 7 (with demo mode); Telegram (stretch)
- [x] [PR #6](https://github.com/Arjav122/vehicle-access-gate/pull/6) opened, CI green, merged into `main`

## Phase 6 — Frontend

Branch `phase-6-frontend`, from `main`.

Server support the screens need:
- [ ] `GET /analytics/overview?days=14` (busiest hours, daily traffic, average visit, overstay rate, frequent visitors) and `GET /analytics/inside`, IST
- [ ] `GET /demo` (one-click demo logins, only when `DEMO_MODE=true`)
- [ ] Seed: 14 days of closed history + a small "right now" state, written through the services
- [ ] `npm run openapi` writes `client/openapi.json`; CI fails if it drifts

Client:
- [ ] Tooling: Tailwind, shadcn-style components (Radix), TanStack Query, React Router, Recharts, sonner, lucide-react, IBM Plex Sans
- [ ] Design system: CSS-variable tokens, light + dark, IND-strip blue accent, status colours with words; `PlateChip`
- [ ] API client from generated types (openapi-typescript + openapi-fetch), tokens in memory + localStorage, refresh on 401
- [ ] One Socket.io connection per tab; events invalidate queries; refetch after reconnect
- [ ] Landing, login + demo buttons, role-checked lazy routes, 404 + error pages
- [ ] Guard console: arrivals · waiting · alerts/review/call tasks; inside counter; register-visitor dialog (`?register=&event=`), guest code, manual entry/exit
- [ ] Resident app: approvals with countdown, guest passes, history, profile
- [ ] Admin: overview analytics (+ "view as table"), visits, resource tables, checks, notifications, audit log, settings
- [ ] Vitest + Testing Library tests; lint, types, build
- [ ] Screenshots in `docs/assets/`; decisions; `docs/learn/phase-6.md`

