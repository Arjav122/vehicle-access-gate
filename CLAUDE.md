# Build Brief: AI Vehicle Access Management System — v2 (React + Node.js + Python ANPR)

**How to use:** save this file as `CLAUDE.md` in the repo root (Claude Code reads it
automatically) or paste it into your coding agent. Then say:
**"Read the whole brief, then start Phase 0."** After each phase: review, merge, then say
**"Start Phase N."** One phase per session works best.

---

## 0. Your role and the rules

You are a senior full-stack + computer-vision engineer. My repo (currently v1: FastAPI +
Next.js) is open in this folder. Rebuild it into a polished, production-style,
recruiter-ready project with a new stack. I will review each phase and then study the code
for interviews, so everything must be simple, explainable and documented.

Non-negotiable rules:
1. **Phases (§19).** One phase = one git branch `phase-N-short-name` = one pull request into
   `main`. Stop at the end of every phase, report, and wait.
2. **Modular but minimal.** One clear job per file, follow the layout in §7 exactly, no extra
   folders or libraries "just in case", plain functions over classes. If a new file is truly
   needed, say why first.
3. **Never invent numbers.** Every metric in README/docs comes from a run you actually did, or
   is marked `TBD (measured in Phase X)`.
4. **Never commit secrets.** Only `.env.example` with safe dev defaults. gitleaks in CI.
   Never ask me to paste a secret into chat.
5. **Verify before claiming done:** lint, type-check, run the tests, start the stack. Never say
   something works if you didn't run it.
6. **Don't silently cut scope.** If something here is a bad idea or outdated (library
   abandoned, free tier changed), say so, propose an alternative, and log it in
   `docs/decisions.md`.
7. **Don't create accounts or accept terms for me** — give me step-by-step instructions.
8. **If blocked** (network, dataset, credentials, a decision), stop and ask clearly.
9. **Every bug fix comes with a test** that would have caught it.
10. **Use current stable versions** (Node LTS, Python 3.12, etc.) and check them when you start.
11. **Never delete or move anything in Phase 0 without my approval** of a KEEP/MOVE/DELETE list.

---

## 1. Current repo (v1) and what happens to it

Current state (confirm by reading it):
- `backend/` — FastAPI + SQLAlchemy + PostgreSQL, 5 Alembic migrations; routes: auth,
  residents, visitors, operations; `services/anpr/` = YOLO11 detector + PaddleOCR with EasyOCR
  fallback + optional OpenAI cleanup; services: alerts, dashboard, reports, email, scheduler,
  AI assistant (LangChain + OpenAI); untracked `backend/_run_no_migrate.py`.
- `frontend/` — Next.js 14 + Tailwind: login, alerts, approvals, assistant, logs, reports,
  residents, visitors.
- Root: `README.md`, `docker-compose.yml`, `DOCKER.md`, `requirements.txt`, `.env` (ignored),
  `.env.example`.
- `docs/` — **untracked academic report** (.md/.docx/.pptx + generator script). Not part of
  this project.
- Uncommitted WIP: a cleanup deleting LangGraph agents, settings, vehicles, a smoke test, and
  frontend dashboard/live/settings/vehicles pages, plus edits to `operations.py`,
  `visitors.py`, `api.ts`, README.

| Old | New |
|---|---|
| `backend/services/anpr/` (YOLO11 + PaddleOCR) | Refactored into the `anpr/` edge worker (§11). Keep my trained YOLO11 weights. |
| EasyOCR fallback | Kept only if measured ≥ 2 points better exact-plate accuracy (§11.3); else removed |
| OpenAI plate cleanup | Removed — replaced by frame voting + server-side plate repair |
| AI assistant (LangChain) | Removed (overlaps with my other project) |
| alerts / dashboard / reports / email / scheduler / operations / visitors logic | **Read first**, then port behaviour to `server/` (Node). Don't lose features. |
| SQLAlchemy models + Alembic | Replaced by Prisma schema (fresh database, no data migration) |
| `frontend/` (Next.js) | Replaced by `client/` (React + Vite); reuse good UI ideas |
| "approvals" page | Becomes resident approvals + guard decision fallback |
| "reports" page | Becomes Admin analytics + filtered visit/event lists with CSV export |
| `DOCKER.md`, root `requirements.txt`, `_run_no_migrate.py`, smoke tests, leftover agent code | Delete |
| `docs/` academic report | Move **outside** the repo (e.g. `../capstone-report/`) after my approval; never commit it. `docs/` is then reused for project docs. |

---

## 2. What we are building

An AI-powered gate and visitor management system for Indian housing societies. A camera reads
number plates so residents drive in without stopping; visitors are approved by the resident on
their phone in real time; vehicles that stay too long are followed up automatically.

### Core flow
```
Camera (entry or exit lane)
 → ANPR worker: YOLO detector → OCR → frame voting → ONE read per car → API (device key)
 → API repairs the plate (O/0, B/8 … by position), validates Indian formats, fuzzy-matches
 → On the watchlist?   → red high-priority alert on the guard console (checked FIRST)
 → Low confidence?     → guard review queue; guard's correction saved as labelled data
 → Resident vehicle?   → ENTRY / EXIT logged automatically (entry and exit paired)
 → Valid guest pass?   → visit created already approved; auto-admit, timer starts
 → Approved visitor?   → visit moves to INSIDE, timer starts
 → Unknown vehicle?    → guard registers visitor (name, phone, email, flat, purpose, category)
                       → resident gets Approve / Deny (in-app real time + optional Telegram)
                       → no answer in 3 minutes → the guard decides
 → Time limit passes   → escalation ladder: email at the limit → reminder +30 min →
                         "call the resident" task for the guard at +60 min (guard dials)
 → Exit camera reads the plate → visit closed
```

### Roles
| Role | Login | Can do |
|---|---|---|
| Admin (society secretary) | email + password | Manage flats, residents, vehicles, guards, gates, camera devices, watchlist; analytics; audit log; settings; demo reset |
| Guard | email + password | Live gate console, register visitors, review unclear plates, acknowledge alerts, handle call tasks, manual entry/exit, redeem guest codes, decide after approval timeout |
| Resident | email + password | Approve/deny visitors, create guest passes, see own flat's history, link Telegram |
| Visitor | no login | Gets an email with visit details |
| Camera device | `X-Device-Key` header | Posts plate reads (gate events) |

---

## 3. Scope

**Core (must have in v2.0)**
- Gate events from camera devices: plate text, OCR confidence, snapshot, lane direction, capture time.
- Plate repair + Indian format validation + bounded fuzzy matching (§10.1).
- Debounce + idempotency: one car in front of a camera = one event (§10.2).
- Visit state machine; resident entry/exit pairing (§10.3).
- Visit categories with time limits: guest 4 h, delivery 20 min, cab 10 min, service (default 120 min); admin-configurable.
- Real-time resident approval with 3-minute timeout → guard decides (§10.4).
- Guest passes by plate or one-time code, with validity window and usage limit (§10.5).
- Escalation ladder + email notifications with retries (§10.6).
- Watchlist alerts (even on low-confidence reads); review queue + stored corrections.
- Snapshots for every event.
- Analytics: busiest hours, average visit duration, overstay rate, frequent visitors, vehicles inside.
- Nightly reconciliation (exits without entries, entries never closed, stale visits).
- Privacy: phones masked in lists, visitor data deleted after 90 days (configurable), audit log of admin changes.
- ANPR edge worker with offline buffer + laptop-webcam preview page (§11).
- Demo mode + traffic simulator so the deployed demo always looks alive (§13).

**Stretch (only after core is done and green)**
- Telegram inline Approve/Deny buttons (optional, works only if a bot token is configured).
- English / हिन्दी toggle on the guard console.
- Prometheus `/metrics`; static INT8 quantisation of the detector; small load test.
- Hosted "Try ANPR on a photo" endpoint.

**Out of scope (list under "Future work")**
Multi-society tenancy, paid SMS/voice-call providers (Twilio), native mobile apps, LLM
assistant/chatbot, LLM plate cleanup, face recognition, payments, video-file uploads from the
browser, tailgating detection.

---

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| API server | Node.js (current LTS) + TypeScript (strict) + Express | thin routes, logic in `services/` |
| Validation + API docs | Zod + `@asteasolutions/zod-to-openapi` + swagger-ui-express | OpenAPI generated from Zod schemas, docs at `/api/docs` |
| Database | PostgreSQL + Prisma. **Hosted DB = Supabase (Postgres only)**; local dev uses the Postgres container | CHECK constraints / partial indexes via SQL in migrations. Use Supabase only as Postgres (+ optionally its S3-compatible Storage for snapshots) — NOT Supabase Auth, its client SDK, or Row Level Security; our Node API owns auth and permissions |
| Real time | Socket.io (rooms per role / per user) | single instance; Redis adapter is future work |
| Background jobs | `node-cron` inside the server process, enabled by `RUN_JOBS=true` | DB-level idempotency makes restarts safe |
| Auth | JWT access (15 min) + rotating refresh tokens (7 days), argon2id | |
| Uploads | multer (memory storage, size-limited) | |
| Email | Nodemailer (SMTP); Mailpit catches mail in dev | HTML + plain-text templates |
| Logging | pino (JSON, request id on every line) | |
| Security | helmet, CORS allow-list, express-rate-limit, body size limits | |
| ANPR worker | Python 3.12 package: ONNX Runtime, OpenCV (headless), NumPy, PaddleOCR (EasyOCR only if measured better), httpx, SQLite | **no PyTorch/Ultralytics at run time** |
| ML training/export | Ultralytics YOLO11 (my existing weights) → ONNX export; notebook for optional retraining on free GPU | |
| Frontend | React + TypeScript (strict) + Vite, Tailwind CSS, shadcn/ui (Radix), TanStack Query, React Router, Recharts, sonner, lucide-react | |
| API client | openapi-typescript + openapi-fetch (types generated from the server's OpenAPI) | CI fails on drift |
| Testing | Vitest + supertest (server, real Postgres), pytest (anpr), Vitest + Testing Library (client), Playwright (3 journeys) | |
| Quality | ESLint (type-aware), Prettier, ruff, gitleaks | |
| Infra | Docker (multi-stage, non-root, healthchecks), Docker Compose, Caddy (prod HTTPS reverse proxy), GitHub Actions | |

---

## 5. Architecture

```
At the gate (edge)                          Server (one docker-compose.prod.yml)
┌──────────────────────────┐   HTTPS +     ┌────────────────────────────────────────┐
│ Camera / webcam / video  │  device key   │ Caddy (HTTPS, serves React build,      │
│   → ANPR worker (Python) │ ────────────► │        proxies /api and /socket.io)    │
│     ONNX YOLO + OCR      │               │   → Node API (Express + Socket.io      │
│     frame voting         │               │       + node-cron jobs)                │
│     SQLite offline buffer│               │   → PostgreSQL     → snapshots volume  │
│   → local preview page   │               │   → Simulator (demo only, public API)  │
└──────────────────────────┘               │   → SMTP / Mailpit, Telegram (optional)│
                                           └────────────────────────────────────────┘
Browsers: Guard console · Resident app · Admin dashboard · Landing  (REST + WebSocket)
```

Key principles:
- **The camera reads, the server decides.** The ANPR worker only finds plates, reads text,
  votes across frames and sends one read per car. All plate repair, validation and matching
  live in ONE place on the server (`services/plates.ts`), so they never disagree.
- **Routes are thin.** A route parses input (Zod), checks permissions, calls a service, returns
  a schema. Business rules live in `services/` as plain functions that take a Prisma client /
  transaction, so they are testable without HTTP.
- **Services own transactions.** DB constraints (unique, FK, CHECK) enforce correctness; a
  helper turns a constraint violation into a clear 409.
- **Real time = publish after commit.** Socket.io events are emitted after the transaction
  commits; emit failures are logged, never fatal.
- **Why no Redis/queue:** single server instance keeps it simple; jobs and debounce use
  Postgres. Document in `docs/decisions.md` what would change to scale out (Redis adapter for
  Socket.io, BullMQ, Redis debounce).

---

## 6. Database hosting: Supabase

I already use **Supabase** as my hosted PostgreSQL. Rules:
- Prisma connects with two URLs: `DATABASE_URL` = Supabase **pooled** connection
  (transaction pooler, port 6543, add `?pgbouncer=true`) for the running app, and
  `DIRECT_URL` = **direct/session** connection (port 5432) for `prisma migrate`. Configure
  `directUrl` in `schema.prisma`. SSL required.
- Advisory locks, `FOR UPDATE`, and `FOR UPDATE SKIP LOCKED` must be used **inside a
  transaction** (they are safe with the transaction pooler that way). If anything needs a
  session-level feature, use `DIRECT_URL` and document why.
- Local dev and CI use the Postgres container (same major version as Supabase), so tests never
  touch the hosted DB.
- In production, `docker-compose.prod.yml` does **not** run a Postgres container; the server
  points at Supabase. Keep the compose file able to run a local Postgres via a profile for
  people without Supabase.
- Snapshots: `SNAPSHOT_STORAGE=local` by default; optionally `s3` pointing at Supabase
  Storage's S3-compatible endpoint (a private bucket). Never make the bucket public.
- Check Supabase's current free-tier limits (storage, connections, inactivity pausing) and note
  them in `docs/deployment.md`; the demo simulator's traffic keeps the project active.
- Never put the Supabase service-role key or DB password in the client or in git.

---

## 7. Repository layout (follow exactly)

```
vehicle-access/
├── CLAUDE.md                    # this brief
├── README.md  LICENSE (MIT)
├── docker-compose.yml           # dev: postgres, mailpit, server, client
├── docker-compose.prod.yml      # prod: migrate, server, simulator, caddy (DB = Supabase)
├── Caddyfile
├── .env.example                 # every variable documented
├── .gitignore  .editorconfig  .gitleaks.toml
├── .github/
│   ├── workflows/ci.yml  workflows/deploy.yml
│   └── pull_request_template.md
├── server/
│   ├── prisma/  schema.prisma  migrations/  seed.ts
│   ├── src/
│   │   ├── index.ts             # app setup, middleware, routes, socket, jobs
│   │   ├── config.ts            # env parsed with Zod; refuses default JWT secret in production
│   │   ├── db.ts                # Prisma client + tx helper + constraint→409 helper
│   │   ├── middleware.ts        # auth, device auth, roles, validate, request id, errors, limits
│   │   ├── realtime.ts          # Socket.io setup, rooms, publish helpers
│   │   ├── jobs.ts              # node-cron schedule (§10.6)
│   │   ├── openapi.ts           # registry → OpenAPI JSON + Swagger UI
│   │   ├── simulator.ts         # demo traffic generator (separate process, public API only)
│   │   ├── routes/              # auth, flats, residents, vehicles, guards, gates, devices,
│   │   │                        # watchlist, gateEvents, alerts, visits, approvals,
│   │   │                        # guestPasses, escalations, reconciliation, analytics,
│   │   │                        # settings, auditLogs, telegram, demo, system (one file each)
│   │   └── services/
│   │       ├── plates.ts        # repair, validate, fuzzy match (pure)
│   │       ├── visitState.ts    # state machine table (pure)
│   │       ├── gateEvents.ts    # ingest: idempotency, debounce, match, pairing, alerts
│   │       ├── visits.ts        # register, transition_visit (only writer of status)
│   │       ├── approvals.ts     # request, decide, timeout
│   │       ├── guestPasses.ts   # create, redeem, match
│   │       ├── escalation.ts    # runLadder(now) (pure decisions + idempotent writes)
│   │       ├── notifications.ts # queue + dispatch with retries, email templates
│   │       ├── reconciliation.ts
│   │       ├── retention.ts
│   │       ├── analytics.ts
│   │       ├── storage.ts       # snapshot storage: local (default) | S3-compatible
│   │       ├── telegram.ts      # optional
│   │       └── audit.ts
│   ├── tests/
│   ├── Dockerfile  package.json  tsconfig.json
├── anpr/
│   ├── anpr/
│   │   ├── cli.py               # entry point and flags
│   │   ├── config.py            # pydantic-settings, prefix ANPR_
│   │   ├── sources.py           # webcam / RTSP / video file / image folder
│   │   ├── detector.py          # ONNX YOLO: letterbox, NumPy decode, NMS
│   │   ├── ocr.py               # crop preprocessing + OCR engine
│   │   ├── tracker.py           # frame voting → one read per car
│   │   ├── client.py            # POST /api/gate-events with retries
│   │   ├── buffer.py            # SQLite offline buffer + ordered replay
│   │   ├── preview.py  preview.html   # local webcam demo page (§11.6)
│   │   └── download_model.py    # fetch weights from GitHub Release, SHA-256 check
│   ├── notebooks/  train_detector.ipynb  compare_ocr.ipynb
│   ├── eval/  evaluate.py  results/
│   ├── tests/  DATASET.md  Dockerfile  pyproject.toml
├── client/
│   ├── src/
│   │   ├── app/                 # router, providers, layouts, route guards
│   │   ├── features/            # landing, auth, guard, resident, admin, shared
│   │   ├── components/ui/       # shadcn-style components + PlateChip
│   │   ├── lib/                 # api client + generated schema.d.ts, auth, socket, plates format, format
│   │   └── i18n/  en.json  hi.json   (stretch)
│   ├── e2e/                     # Playwright journeys
│   ├── public/  Dockerfile  package.json  openapi.json
└── docs/
    ├── PROGRESS.md              # phase table + checklists, updated every session
    ├── decisions.md             # one section per decision: context, decision, alternatives, consequences
    ├── architecture.md  database.md  deployment.md  webcam-demo.md
    ├── learn/  phase-0.md … phase-9.md  INTERVIEW_GUIDE.md
    └── assets/                  # screenshots, demo.gif
```

---

## 8. Data model (PostgreSQL via Prisma)

Conventions: UUID ids; `createdAt/updatedAt` timestamptz in UTC; enums as lower-case strings
with CHECK constraints (or Prisma enums — pick one and record why); named constraints; plates
stored twice: `plateRaw` + `plateNormalized`; people are deactivated, not deleted; schema
changes only through migrations.

| Table | Key columns and rules |
|---|---|
| society_settings | single row: guest/delivery/cab/service minutes, approvalTimeoutSeconds, confidenceThreshold, visitorRetentionDays. No row → config defaults |
| flats | block, number (unique, shown as B-402), floor |
| users | email (lower-case, unique), fullName, phone, role (admin/guard/resident), passwordHash (argon2id), telegramChatId (unique, nullable), isActive |
| residents | user ↔ flat link, residentType (owner/tenant/family), isPrimaryContact (max one per flat) |
| refresh_tokens | jti, userId, expiresAt, revokedAt |
| vehicles | flatId (a vehicle belongs to a flat), plateRaw, plateNormalized (unique, indexed), vehicleType (car/two_wheeler), makeModel, colour, isActive |
| watchlist | plateNormalized (unique), reason, isActive |
| gates | name, isActive |
| devices | gateId, direction (entry/exit), apiKeyHash (SHA-256, unique), apiKeyPrefix, lastSeenAt (written at most once a minute), isActive |
| gate_events | deviceId, gateId + direction (copied), plateRaw, plateNormalized, ocrFixes, confidence, snapshotKey, capturedAt, lastSeenAt (debounce), eventHash (unique), matchResult (resident/visitor/guest_pass/watchlist/low_confidence/ambiguous/unknown), matchDistance (0/1), vehicleId, visitId, pairedEventId (unique: an exit closes one entry), needsReview, reviewReason, reviewedAt, reviewedById. Partial index on the open review queue |
| plate_corrections | gateEventId, originalPlate, correctedPlate, guardId (labelled data for retraining) |
| alerts | gateEventId, kind (watchlist), severity, message, acknowledgedAt/By |
| visitors | fullName, phone, email (purged after retention) |
| visits | flatId, visitorId, guestPassId, plateNormalized, category (guest/delivery/cab/service), purpose, status, entryEventId, exitEventId, enteredAt, expectedExitAt, exitedAt, durationMinutes, approvedById |
| visit_status_changes | visitId, fromStatus, toStatus, trigger, actorUserId or gateEventId, changedAt — append-only, same transaction |
| approvals | visitId, status (pending/approved/denied/timed_out), expiresAt, channel (web/telegram/guard), decidedById |
| guest_passes | flatId, plateNormalized?, codeHash? (unique), validFrom, validUntil, maxUses, useCount. CHECK (plate OR code), CHECK (useCount <= maxUses) |
| escalation_tasks | visitId (unique), status (open/resolved), outcome (reached/not_reached/vehicle_left), notes |
| notifications | channel (email/telegram), kind, recipient, subject, bodyText, bodyHtml, status (pending/sent/failed), attempts, nextAttemptAt, lastError, idempotencyKey (unique) |
| reconciliation_flags | kind, subjectId, gateEventId, visitId, resolvedAt; unique per (kind, subject) |
| audit_logs | actorId, action (e.g. vehicle.update), entityType, entityId, changes JSON (e.g. {"colour": ["White","Grey"]}); never passwords |

Delete rules: guards/residents → deactivate; flats, gates, devices → delete only if nothing
references them, else 409; vehicles and watchlist entries → delete (gate events keep plate
text; vehicleId → NULL). `docs/database.md` has a Mermaid ER diagram + one line per table.

---

## 9. API (base path `/api`)

Conventions: people send `Authorization: Bearer <access>`; cameras send `X-Device-Key: vd_…`.
Lists return `{ items, total, limit, offset }` (limit default 20, max 100) with filters. Updates
are PATCH with only changed fields. Unknown fields → 422. Errors `{ "detail": "..." }` with
401/403/404/409/413/422/429 (+Retry-After)/503. Every response has `X-Request-ID` + security headers.

| Method & path | Admin | Guard | Resident | Notes |
|---|---|---|---|---|
| POST /auth/login, /auth/refresh, /auth/logout | public | | | refresh tokens single-use |
| GET /me | ✅ | ✅ | ✅ | residents also get their flats |
| GET /flats, /vehicles | ✅ | ✅ | ❌ | search `402` or `B-402`, plate search |
| CRUD /flats, /vehicles, /residents, /guards, /gates, /watchlist | ✅ | ❌ | ❌ | plates cleaned + validated; audited |
| CRUD /devices + POST /devices/:id/rotate-key | ✅ | ❌ | ❌ | key returned once |
| GET /devices/me | device | | | camera checks its key |
| POST /gate-events | device | | | multipart (contract below) |
| GET /gate-events, /gate-events/:id/snapshot | ✅ | ✅ | ❌ | filters: direction, matchResult, needsReview, gate, q, since, until; CSV export |
| GET /gate-events/review-queue, POST /gate-events/:id/review | ✅ | ✅ | ❌ | `{action:"correct", plate}` re-runs matching, or `{action:"dismiss"}`; once per event |
| GET /alerts, POST /alerts/:id/acknowledge | ✅ | ✅ | ❌ | idempotent |
| POST /visits | ✅ | ✅ | ❌ | registers visitor → approval; optional gateEventId links the waiting car |
| GET /visits | ✅ | ✅ | own flats | phones masked |
| POST /visits/:id/decision | ✅ | ✅ | ❌ | guard fallback; 409 while residents can still answer |
| POST /visits/:id/enter, /visits/:id/exit | ✅ | ✅ | ❌ | manual |
| GET /approvals, POST /approvals/:id/decision | read | read | decide | same answer twice = 200, different = 409 |
| POST /guest-passes, POST /guest-passes/:id/revoke | ❌ | ❌ | ✅ | code returned once |
| GET /guest-passes | ✅ | ✅ | own flats | |
| POST /guest-passes/redeem | ✅ | ✅ | ❌ | guard types a guest's code |
| GET/PATCH /settings | edit | read | ❌ | audited |
| GET /escalations, POST /escalations/:id/resolve | ✅ | ✅ | ❌ | tasks show full resident phone (guard must dial) |
| GET /reconciliation, POST /reconciliation/:id/resolve | ✅ | ❌ | ❌ | |
| GET /notifications | ✅ | ❌ | ❌ | delivery log |
| GET /analytics/overview?days=14, GET /analytics/inside | ✅ | inside only | ❌ | IST time zone |
| GET /audit-logs | ✅ | ❌ | ❌ | read-only |
| POST /telegram/link-code, DELETE /telegram/link, POST /telegram/webhook | | | ✅ | stretch; 404 if no bot token |
| GET /demo, POST /demo/reset | public / admin | | | only when DEMO_MODE=true, else 404 |
| GET /health, GET /ready, GET /docs | public | | | ready checks Postgres |

**Gate event contract** (`POST /api/gate-events`, multipart):
| Field | Required | Notes |
|---|---|---|
| plate_text | ✅ | 1–32 chars; spaces, dashes, look-alikes fixed by the server |
| confidence | ✅ | OCR confidence 0–1; below threshold (0.80) → review queue |
| captured_at | | ISO 8601 with timezone; > 5 min in the future → 422 |
| direction | | must match the device's lane |
| snapshot | | JPEG/PNG/WebP checked by magic bytes, max 2 MB (413) |

Response: `created` (201, with matchResult), `duplicate` (200, exact retry), `debounced` (200).

**Socket.io events** (`{type, at, data}`), auth with the access token on connect (bad token →
disconnect): `gate_event.created`, `alert.created` (staff room); `approval.requested`,
`approval.decided`, `approval.timed_out`, `visit.updated` (staff + that flat's residents);
`escalation.created`, `escalation.resolved` (staff). Rooms: `staff`, `user:<id>`.

---

## 10. Core logic (implement exactly; record each in `docs/decisions.md`)

### 10.1 Plate repair and fuzzy matching (`services/plates.ts`, pure)
- Strip spaces/dashes/punctuation, upper-case. Drop the HSRP **IND** mark at either end,
  including OCR look-alikes (`INO`, `IN0`, `1ND`).
- Valid layouts: **standard** = state (2 letters, must be a real state/UT code) + district
  (1–2 digits) + series (0–3 letters) + number (1–4 digits); **BH** = year (2 digits) + `BH` +
  4 digits + 1–2 letters.
- Try every layout of the right length. A character of the wrong kind is swapped for its
  look-alike (O↔0, I↔1, B↔8, S↔5, Z↔2, G↔6, T↔7, A↔4) at cost 1; no look-alike → layout ruled
  out. Score = fixes + small penalties for legal-but-uncommon shapes (3-digit numbers, 1- or
  3-letter series, 1-digit district outside Delhi). Lowest score wins. Example:
  `KAO5MNOO42 → KA05MN0042`. Never produce I, O or Q in a series. More than 3 fixes → unreadable.
- Fuzzy match: Levenshtein ≤ 1 (`PLATE_FUZZY_MAX_DISTANCE`) against active vehicles, active
  watchlist and visits expected at that lane. Pre-filter by length in SQL, compare
  `(plate, id)` tuples in memory with early exit, load only the winner. Exact beats fuzzy. Two
  equally close plates → no guess → review queue (`ambiguous`).
- Order: **watchlist first (even for low confidence)** → low confidence / unreadable → review
  queue → resident vehicle → guest pass / expected visitor → unknown.
- Table-driven test suite with ≥ 40 cases, including the tricky ones above.

### 10.2 Debounce and idempotency (in `services/gateEvents.ts`, Postgres only)
- **Idempotency:** `eventHash = sha256(deviceId | repaired plate | capturedAt to the ms)`,
  unique. A retry returns the existing row (`duplicate`). If two copies race, the unique
  constraint rejects one; return the winner and delete the loser's snapshot.
- **Debounce:** sliding window `GATE_EVENT_COOLDOWN_SECONDS=30` per (device, repaired plate).
  Inside a transaction holding `pg_advisory_xact_lock(hash(device, plate))`: if an event for
  that pair has `lastSeenAt >= capturedAt - 30s`, push its `lastSeenAt` forward and return
  `debounced` (not stored). Compare using the camera's `capturedAt`, not arrival time, so
  replayed offline reads stay separate events.

### 10.3 Visit state machine (`services/visitState.ts` pure + `services/visits.ts`)
```
[*] → PENDING_APPROVAL ;  [*] → APPROVED (guest pass)
PENDING_APPROVAL → APPROVED (approve) | DENIED (deny) | EXPIRED (expire)
APPROVED → INSIDE (enter) | EXPIRED (expire)
INSIDE → OVERSTAYED (overstay) | EXITED (exit)
OVERSTAYED → ESCALATED (escalate) | EXITED (exit)
ESCALATED → EXITED (exit)
```
- One table `(status, trigger) → newStatus`: 8 statuses, 7 triggers, 10 legal moves. Anything
  else throws `IllegalTransitionError` → 409, nothing changes. Unit-test all 56 pairs.
- `enter` sets enteredAt and expectedExitAt = enteredAt + category limit (unless a duration was
  agreed); `exit` sets exitedAt. Camera triggers use the event's capturedAt as the time.
- **One writer:** only `transitionVisit()` changes status, and it writes a
  `visit_status_changes` row in the same transaction.
- Resident vehicles (no visit): entry→exit paired via `pairedEventId` using `SELECT … FOR UPDATE`.

### 10.4 Approvals
- One approvals row per request, locked `FOR UPDATE` while deciding: two residents tapping at
  once are serialised; first wins; same answer again = 200, different = 409. Web and Telegram
  call the same function.
- Timeout: a job every 15 s expires overdue approvals, and every late answer checks the clock
  itself. Expired → guard decides.
- If the guard registered the visitor against the waiting car's read (gateEventId), approval
  moves the visit straight to INSIDE; otherwise it stays APPROVED until a camera read or manual enter.
- Telegram (stretch): one-time link code (hashed, 10 min) via `https://t.me/<bot>?start=<code>`;
  inline Approve/Deny; webhook verified with `X-Telegram-Bot-Api-Secret-Token`; one
  notifications row per resident per approval prevents double sends.

### 10.5 Guest passes
Plate and/or an 8-character code from an alphabet without look-alikes, stored as HMAC-SHA256
with the server secret, returned once. Validity window + maxUses; uses counted with a
conditional UPDATE (`useCount < maxUses`). A plate match creates the visit already
APPROVED → INSIDE; the guard can redeem a code by typing it.

### 10.6 Escalation, notifications and scheduled jobs (`jobs.ts`, node-cron, `RUN_JOBS=true`)
| Job | When | What |
|---|---|---|
| approvals.expire | every 15 s | hand unanswered approvals to the guard |
| escalation.tick | every minute | ladder: email visitor + resident at the limit, reminder +30 min, guard "call the resident" task +60 min |
| notifications.dispatch | every minute | send due emails/Telegram; backoff 1, 2, 4 … 60 min, max 5 attempts, then failed with the error |
| reconciliation.nightly | 03:00 IST | exits without entries, entries never closed, visits inside a day past the limit (a resident's parked car with one open entry is normal) |
| retention.daily | 03:30 IST | delete visitor personal data past retention, redact old notifications, delete old snapshots |
| demo.nightlyReset | 04:00 IST | reseed only when DEMO_MODE=true |

- `runLadder(now)` is driven by the clock passed in; each step is idempotent (the state machine
  refuses a second overstay/escalate; email idempotency keys like
  `visit:<id>:overstay_reminder:resident:<userId>`; one escalation task per visit). Running it
  twice, or once after an outage, does each due step exactly once and in order. Test with a mocked `now`.
- **Queue, then dispatch:** steps only insert notification rows (`ON CONFLICT DO NOTHING`); the
  dispatcher claims rows with `FOR UPDATE SKIP LOCKED`.
- Any EXIT resolves an open escalation task with `vehicle_left`.

### 10.7 Auth and security
- argon2id; for an unknown email still verify against a dummy hash (no timing leak); same error
  for every failure.
- Access JWT 15 min (algorithm pinned, required claims sub/type/jti/exp); refresh 7 days,
  stored by jti, single-use rotation; reuse of a revoked token revokes all that user's
  sessions. Logout revokes. Load the user from DB on every request (deactivation is immediate).
- RBAC middleware `requireRoles(...)`; a test walks every route with every role.
- Device keys: `vd_` + 32 random bytes, shown once; store SHA-256 + short prefix.
- Server refuses to start in production with the default JWT secret.
- Rate limits: login per IP (20/min) and per account (10/min); cameras per key (600/min); 429 + Retry-After.
- Body limits: 1 MiB default, snapshot max + 64 KB for camera uploads.
- helmet headers, CORS allow-list (none needed in prod: one origin behind Caddy).
- Privacy: phones masked in lists (`+919876543210 → +91 98•••••210`), audit log for every admin
  create/update/delete, codes and keys stored only as hashes.

### 10.8 Snapshot storage (`services/storage.ts`)
`save / load / delete` with a local-folder implementation (default, Docker volume) and an
S3-compatible one (optional, e.g. Cloudflare R2) chosen by `SNAPSHOT_STORAGE=local|s3`. Keys:
`<yyyy>/<mm>/<dd>/<eventId>.jpg`. Staff download via `GET /gate-events/:id/snapshot` (role checked).

### 10.9 Observability
Request id per request (kept from `X-Request-ID` if sane), returned in the response and on every
pino log line. `/health` (liveness), `/ready` (Postgres, 503 if down). Prometheus metrics = stretch.

---

## 11. ANPR edge worker (`anpr/`) — the plate-scanning pipeline

### 11.1 Sources and CLI
`python -m anpr.cli --source 0` (webcam; on Windows open with DirectShow at 1280x720) |
RTSP/HTTP URL | video file | image folder. Flags: `--direction entry|exit`, `--dry-run`, `-v`,
`--preview`. Timestamps: video time for recordings, wall clock for live cameras.

### 11.2 Detector (`detector.py`)
Export my YOLO11 plate model to ONNX once (Ultralytics only in the export/notebook step).
At run time: ONNX Runtime + letterboxing + decoding the `(1, 5, N)` output + NMS written in
~80 lines of NumPy — **no Ultralytics/PyTorch at run time** (smaller image, no AGPL code on the
edge). Load the model once. Test decode/NMS against hand-built tensors.

### 11.3 OCR (`ocr.py`)
Crop with a small margin, preprocess (grayscale, resize, optional CLAHE via
`ANPR_OCR_CONTRAST`), run PaddleOCR. Send **OCR confidence**, not detector confidence. The
worker only drops an OCR piece that is just the `IND` mark; all other repair happens on the
server. `notebooks/compare_ocr.ipynb` compares PaddleOCR vs EasyOCR on labelled photos — keep
EasyOCR only if it wins by ≥ 2 points of exact-plate accuracy.

### 11.4 Tracker / frame voting (`tracker.py`)
Sample frames at `ANPR_SAMPLE_FPS=5`. Reads within 2 edits of each other join one track; texts
voted by summed confidence (optional per-character voting within the track). Send early after
`ANPR_TRACK_MIN_AGREEING_READS=3` agreeing reads, otherwise when the plate has been out of view
for `ANPR_TRACK_GAP_SECONDS=2`. One car = one read sent.

### 11.5 Client + offline buffer (`client.py`, `buffer.py`)
POST to `/api/gate-events` with the device key, retries with backoff (`ANPR_MAX_RETRIES=4`).
If the server is unreachable, buffer in SQLite (WAL, synchronous=FULL); replay oldest-first;
new reads queue behind old ones; permanent 4xx rejections move to a `rejected` table instead of
blocking the queue. Safe because the server deduplicates.

### 11.6 Laptop webcam demo (`preview.py`, `preview.html`)
`python -m anpr.cli --source 0 --preview` serves `http://127.0.0.1:8765` using the Python
standard-library `http.server` (no new dependency): MJPEG video with plate boxes, the text
read, and the server's decision colour-coded **with words** ("Resident car: entry logged",
"New car: register the visitor", "Watchlist plate"). Buttons **Entry / Exit / Scan again**
(keys E, X, Space) and **Register this visitor**, which opens
`/guard?register=<plate>&event=<id>` with the form prefilled and linked to the read.
- Three threads: camera (newest frame only), analysis (owns the pipeline), web server.
- One webcam = two devices (entry + exit), each with its own key and offline buffer. A server
  script `npm run webcam:devices` creates/reuses the two devices, rotates their keys and writes
  them to `anpr/.env` (keeping other lines).
- Page security: binds to 127.0.0.1, checks the Host header, POST buttons need a custom header,
  CSP `frame-ancestors 'none'`.
- "Save for testing" button stores frame + typed plate into a labels CSV for real accuracy measurement.

### 11.7 Weights, training, evaluation
- Weights never in git: published as a GitHub Release asset (`models-v1`), fetched by
  `python -m anpr.download_model` with a SHA-256 check.
- `notebooks/train_detector.ipynb` (optional, free Kaggle/Colab GPU): retrain/fine-tune on
  openly licensed Indian plate datasets, evaluate on a separate held-out set from a different
  source. Fix the model-selection rule before seeing numbers.
- `eval/evaluate.py` writes tables to `eval/results/`: detection mAP, OCR exact-plate accuracy,
  end-to-end plate accuracy (single frame vs frame voting; with vs without server repair),
  CPU latency (PyTorch vs ONNX FP32; INT8 static = stretch). `DATASET.md` explains folder
  structure + labelling guide for my own photos.

---

## 12. Frontend (`client/`)

Architecture:
- One app, lazy-loaded areas behind role-checked routes: `/` landing, `/login`, `/guard/*`,
  `/resident/*`, `/admin/*`, 404 and error pages.
- Types generated from the server OpenAPI (`server` exports `openapi.json` → `client/openapi.json`
  → `src/lib/schema.d.ts`); CI fails on drift.
- TanStack Query for all server data, no global store. Tokens in memory + localStorage,
  auto-refresh on 401.
- One Socket.io connection per tab; events **invalidate queries** (screens refetch, no patching
  copies). Reconnect with backoff; refetch everything after reconnect.
- On sign-in, update the signed-in-user query in place (don't clear the whole cache).
- Every screen: loading skeletons, helpful empty states, error states, toasts, confirmation
  dialogs for destructive actions.

Design system (write `docs/` notes inside `architecture.md` or a short section):
- Calm, modern (Linear/Vercel feel): neutral greys + one blue accent taken from the IND strip of
  a number plate; 1 px borders instead of shadows; light + dark themes via CSS variables.
- Status colours only mean state (green allowed, amber overstay, red denied/watchlist) and
  always come with a word or icon. WCAG 2.1 AA contrast, keyboard navigable, visible focus.
- **Signature element — `PlateChip`:** every vehicle is drawn as a mini Indian HSRP plate
  (white, thin black border, blue IND strip, condensed bold text grouped as printed:
  `UP16 AB 1234`, `22 BH 1234 AA`); stays white in dark mode.
- Font: IBM Plex Sans (+ Devanagari for Hindi) via @fontsource; tabular numbers.

Areas:
- **Landing (`/`):** pitch, feature highlights, architecture diagram, big "Try demo as Guard /
  Resident / Admin" buttons.
- **Guard console:** dark by default, high contrast, touch targets ≥ 44 px, ≤ 2 taps for common
  actions. Three columns at 1280 px (live arrivals with snapshots · waiting for a decision ·
  alerts, review queue and call tasks), tabs on a phone; "vehicles inside" counter;
  register-visitor dialog (prefill from `?register=&event=`); guest code dialog; manual
  entry/exit. English/हिन्दी toggle = stretch.
- **Resident app (mobile-first):** Approvals (full-width Approve/Deny with visible countdown),
  Guest passes (create in < 30 s, code shown once), History, Profile (Telegram link = stretch).
- **Admin dashboard (sidebar):** Overview analytics (Recharts, tooltips, "view as table"),
  Visits, resource tables (flats, residents, vehicles, guards, gates/devices, watchlist) with
  search/filters/pagination, Checks (reconciliation), Notifications log, Audit log, Settings,
  Reset demo.
- Realistic seed data everywhere (Indian names, B-402, valid plates), never lorem ipsum.
  Responsive at 375 / 768 / 1280+.

---

## 13. Seed, demo mode and simulator

- `npm run seed` (fixed random seed, `--reset`): a made-up society (e.g. "Green Valley
  Residency, Greater Noida"); ~40 flats (blocks A–D); ~60 residents with Indian names; ~80
  vehicles with valid plates (UP16, UP14, DL, HR, BH…); 1 admin, 3 guards, 2 gates each with
  entry + exit devices (keys printed once); 3 watchlist entries; 14 days of closed history plus
  a small "right now" state, written through the same services (so jobs find nothing to
  repeat). Demo logins `admin@example.com`, `guard@example.com`, `resident@example.com`
  (password from `DEMO_PASSWORD`).
- `DEMO_MODE=true` enables `GET /api/demo` (one-click logins) and admin reset; off by default.
- **Simulator** (`server/src/simulator.ts`, separate process from the same image, public API
  only, never the DB): rush hours 8–10 am and 6–9 pm IST; ~50% resident cars in/out; ~30%
  unknown visitors (resident approves most, denies some, some time out → guard decides); ~7%
  guest passes; ~10% blurry reads → review queue; ~3% watchlist (max once per 45 min); some
  visitors overstay so the real escalation ladder runs; a simulated guard clears old items. It
  must **not** rotate keys of real devices (`--leave-devices "Laptop webcam"`) and restarts
  itself after a demo reset. Flags: `--api`, `--speed`, `--seed`, `--minutes`.

---

## 14. Testing, quality and CI

- **Server:** Vitest + supertest against a real Postgres (test DB, isolated per test); every
  role on every route; plate suite (≥ 40 cases); all 56 state-machine pairs; escalation with
  mocked clock; races (approval double-tap, duplicate upload); coverage on `services/` ≥ 80%.
- **ANPR:** pytest for detector decode/NMS, tracker, offline buffer + ordered replay, pipeline
  on an image folder and a short video, preview page security.
- **Client:** Vitest + Testing Library for key components; **Playwright** journeys against the
  real API: (1) resident vehicle entry, (2) unknown visitor approval, (3) overstay escalation.
  axe-core accessibility checks = stretch.
- **CI (GitHub Actions) on every PR:** server (ESLint, Prettier check, tsc, tests with a
  Postgres service container), anpr (ruff, pytest), client (ESLint, tsc, Vitest, build, API
  types match server OpenAPI), e2e (Playwright), `docker compose` smoke test, gitleaks.
- Small Conventional Commits; `main` always green; never force-push `main`. PR description:
  summary, what to look at, screenshots for UI, how to test locally, checklist of anything I must do.

---

## 15. Docker and deployment

- **Dev (`docker-compose.yml`):** postgres, mailpit, server (with jobs), client (Vite). Ports
  bound to 127.0.0.1. `docker compose up --build` then `npm run seed` runs everything.
- **Prod Dockerfiles:** multi-stage, small, non-root, healthchecks. Client image builds static
  files that Caddy serves. ANPR worker has its own image (CPU, no PyTorch) but runs at the edge.
- **Deployment:** first check current free tiers and record the decision in
  `docs/decisions.md`. Expected conclusion: free PaaS web services sleep when idle, which pauses
  cron jobs and the simulator, so the recommended setup is **one server** with
  `docker-compose.prod.yml` (one-shot migrate against Supabase via `DIRECT_URL`, server with
  `RUN_JOBS=true`, simulator, Caddy — database = Supabase, see §6) on an Oracle Cloud Always
  Free VM or a small VPS. Caddy is the only public
  entry point: serves the React build, proxies `/api` and `/socket.io`, gets HTTPS certificates
  automatically (an sslip.io name works without a domain), hides internal endpoints. One origin
  = no CORS. Also document the alternative split (Vercel for the client + Render for the
  server + Supabase) and its limits (idle spin-down pauses jobs and the simulator).
- **CI builds images, not the server:** on green `main`, build images and push to GHCR
  (latest + commit SHA). A deploy job over SSH runs only if `DEPLOY_*` secrets exist (host key
  pinned). Rollback = run an older SHA.
- The ANPR worker stays at the edge (my laptop/webcam); the cloud runs the simulator for the live demo.
- Give me exact steps and an env-var list in `docs/deployment.md`; secrets only in the hosting
  dashboard or GitHub secrets.

---

## 16. Configuration (`.env.example`, every variable documented)

`NODE_ENV, DATABASE_URL (local: postgres container, use 127.0.0.1 not localhost on Windows;
prod: Supabase pooled URL, port 6543, ?pgbouncer=true), DIRECT_URL (Supabase direct URL, port
5432, for migrations), JWT_SECRET, ACCESS_TOKEN_MINUTES=15,
REFRESH_TOKEN_DAYS=7, CORS_ORIGINS, MAX_REQUEST_BYTES, LOGIN_RATE_LIMIT_PER_IP=20,
LOGIN_RATE_LIMIT_PER_ACCOUNT=10, DEVICE_RATE_LIMIT=600, PLATE_CONFIDENCE_THRESHOLD=0.80,
PLATE_FUZZY_MAX_DISTANCE=1, GATE_EVENT_COOLDOWN_SECONDS=30, GATE_EVENT_MAX_CLOCK_SKEW_SECONDS=300,
VISIT_LIMIT_GUEST/DELIVERY/CAB/SERVICE_MINUTES=240/20/10/120, APPROVAL_TIMEOUT_SECONDS=180,
OVERSTAY_REMINDER_MINUTES=30, OVERSTAY_ESCALATION_MINUTES=60, RECONCILIATION_STALE_HOURS=24,
VISITOR_RETENTION_DAYS=90, SMTP_HOST/PORT/SECURE/FROM/USER/PASSWORD, PUBLIC_BASE_URL, RUN_JOBS=true,
SNAPSHOT_STORAGE=local|s3, SNAPSHOT_LOCAL_DIR, SNAPSHOT_MAX_BYTES=2000000,
S3_ENDPOINT/BUCKET/REGION/ACCESS_KEY/SECRET_KEY, TELEGRAM_BOT_TOKEN/BOT_USERNAME/WEBHOOK_SECRET,
DEMO_MODE, DEMO_PASSWORD.`
ANPR worker (prefix `ANPR_`): `API_URL, DEVICE_KEY, EXIT_DEVICE_KEY, DETECTOR_MODEL,
DETECTOR_INPUT_SIZE=640, DETECTOR_CONFIDENCE=0.35, DETECTOR_IOU=0.5, SAMPLE_FPS=5,
TRACK_GAP_SECONDS=2, TRACK_MIN_AGREEING_READS=3, MAX_RETRIES=4, BUFFER_PATH,
CAMERA_WIDTH/HEIGHT=1280/720, PREVIEW_PORT=8765, OCR_CONTRAST=false.`

---

## 17. Known pitfalls (avoid from the start)

- Real webcam reads end with the HSRP "IND" mark (e.g. `HR76AOOO5IND`) — strip it and its
  look-alikes at either end, or no real read becomes a plate.
- The 1-digit district shape is Delhi-only (`DL3C…`); penalise it elsewhere or repair picks the wrong layout.
- Per-character voting at 1 edit split one car into several tracks — group at 2 edits.
- A failed DB save must never silently drop a car: surface the error, keep the read for retry, test it.
- After a visitor is registered, refresh the arrivals list (register action + live events), or
  the guard sees "Register visitor" again and double-registers the same car.
- Demo role switching: don't clear the whole query cache on sign-in; update the user entry in place.
- Test helpers that "sign in" by writing localStorage do nothing if the token store keeps an
  in-memory copy — sign in for real.
- Dynamic INT8 quantisation made YOLO slower; use static INT8 with calibration (stretch).
- In fuzzy matching, compare `(plate, id)` tuples, not full ORM/Prisma objects (cost grows with society size).
- The simulator rotating every camera key breaks a webcam demo running next to it — skip real devices.
- On Windows, `localhost` can try IPv6 first and stall — use `127.0.0.1` in connection strings.

---

## 18. Documentation and study material

- `docs/PROGRESS.md`: phase table (status + PR link) and a checklist per phase, updated at the
  start and end of every session.
- `docs/decisions.md`: one short section per decision (context, decision, alternatives,
  consequences): stack + monorepo, why Node + Python split, data layer, auth, state machine,
  debounce/idempotency, plate repair, ANPR pipeline + model/OCR choice, real time + jobs without
  Redis, escalation/notifications, frontend architecture, hardening + offline mode, deployment,
  webcam demo.
- `docs/learn/phase-N.md` in simple English for every phase: what we built and why; key
  concepts explained simply (JWT, debouncing, idempotency, state machine, NMS, frame voting,
  pub/sub…); files to read in order with one line each; rejected alternatives; 8–10 likely
  interview questions with short answers; one exercise.
- `docs/learn/INTERVIEW_GUIDE.md`: 2-minute pitch, architecture walkthrough, 10 hardest
  questions with answers, "what I'd do differently".
- `docs/architecture.md` (Mermaid), `database.md` (ER), `deployment.md`, `webcam-demo.md`.
- **README (recruiter-first, in this order):** demo GIF from the running app → one-line pitch →
  live demo link + demo logins (or honestly "not deployed yet") → what it does → engineering
  highlights → architecture diagram → results table with real measured numbers only → tech
  stack → quick start → screenshots (guard console, resident app, admin overview) → project
  structure → design decisions (link) → testing → known limitations → future work → licence →
  author. Badges: CI, licence, live demo.

---

## 19. Phases (one branch + one PR each)

**Phase 0 — Safety, cleanup, foundation**
1. Show a `git status` summary. Tag the current `HEAD` as `v1-original` (so the full old
   version is always recoverable). Create branch `phase-0-foundation`.
2. List every file/folder as **KEEP / MOVE / DELETE** with a one-line reason using the mapping
   in §1 (including moving the `docs/` academic report outside the repo). **Wait for my approval.**
3. After approval: apply it (the uncommitted WIP cleanup is superseded — discard or commit it,
   ask me), create the §7 skeleton, MIT licence, `.gitignore`, `.editorconfig`, `.env.example`,
   dev `docker-compose.yml` (postgres, mailpit, placeholder server/client), CI lint + test jobs,
   gitleaks, PR template, README skeleton, `docs/PROGRESS.md`, first entries in `docs/decisions.md`.
Done when `docker compose up` starts cleanly and CI is green.

**Phase 1 — Server core, database, auth**
Express app, Zod config, pino logging, `/health`, `/ready`; full Prisma schema + first migration
(with CHECK constraints and partial index); `docs/database.md`; auth (§10.7); CRUD for flats,
residents, vehicles, guards, gates, devices, watchlist with pagination/filters and audit log;
OpenAPI + Swagger; seed script; tests against Postgres. Done when I can log in as each role in
`/api/docs` and see 403s where expected.

**Phase 2 — Gate event engine**
`POST /gate-events` with device auth and snapshot upload; plate repair + fuzzy matching (§10.1,
≥ 40 tests); idempotency + debounce (§10.2); pure state machine (§10.3, all 56 pairs); resident
entry/exit pairing; watchlist alerts; review queue + corrections; snapshot storage (§10.8).
Done when a scripted sequence of events produces correct visits, alerts and review items in tests.

**Phase 3 — ANPR worker (refactor my existing anpr code)**
Sources, ONNX export of my YOLO11 weights, NumPy decode + NMS, OCR module, tracker, client,
offline buffer, CLI, preview webcam page (§11.6) + `npm run webcam:devices`; OCR comparison
notebook; eval script + results tables; weights as `models-v1` release with hash-checked
download. Done when a video file / image folder run produces correct gate events in the local
stack, and the webcam preview works on my laptop.

**Phase 4 — Visitors, approvals, guest passes, real time**
Visitor registration with categories; approval flow with timeout + guard fallback (§10.4);
Socket.io rooms + events; guest passes (§10.5); settings API; Telegram (stretch, behind a flag).
Done when the full unknown-visitor path works end to end in integration tests.

**Phase 5 — Escalation, notifications, scheduled jobs**
`jobs.ts` schedule (§10.6), HTML + text email templates (visible in Mailpit), escalation tasks
with outcomes, notification queue with retries, reconciliation, retention. Done when
mocked-clock tests move an overstaying visit through every escalation step exactly once.

**Phase 6 — Frontend**
Design system + PlateChip first, then landing, login + demo buttons, guard console, resident
app, admin dashboard + analytics; live updates with reconnect; generated API types; Vitest
tests; screenshots of every main screen in `docs/assets/`. Done when all three journeys can be
clicked through manually and every UI requirement in §12 is met.

**Phase 7 — Simulator, hardening, end-to-end tests**
Simulator (§13); rate limits, size limits, headers, request ids; Playwright journeys in CI;
coverage thresholds; stretch: metrics, small load test of gate-event ingestion with before/after
numbers. Done when e2e passes in CI and the simulator keeps the local dashboard busy.

**Phase 8 — Docker and deployment**
Production Dockerfiles, `docker-compose.prod.yml`, Caddyfile, GHCR images, optional SSH deploy
job, `docs/deployment.md` with exact steps and env vars; seeded demo + simulator + nightly reset
in production. Done when the live URL works, demo logins work and the dashboard shows live
simulated traffic.

**Phase 9 — Polish, docs, release**
README (§18), badges, architecture/deployment docs, demo GIF recorded from the running app,
INTERVIEW_GUIDE.md, link check of all markdown, tag `v2.0.0` with release notes. At the end,
give me 3–4 resume bullets that use only REAL measured numbers.

---

## 20. Each session

1. Read this brief and `docs/PROGRESS.md`; confirm the current phase.
2. Write the phase plan as a checklist in `docs/PROGRESS.md`.
3. Build in small steps; tests alongside code; lint, type-check and test before every commit.
4. Verify for real: full test suite + start the stack.
5. Update docs, write `docs/learn/phase-N.md`, update PROGRESS.md, open the PR.
6. Stop and report: what was built, how to check it, what I must do (merge, `git pull`, add a
   secret, run a notebook…), and what the next phase is.

## 21. Final definition of done

- `docker compose up --build` + seed runs the whole product locally; demo buttons work for all
  three roles; the simulator keeps it busy; the laptop webcam demo reads a real plate end to end.
- All CI checks green on `main`; no secrets in git history.
- Every number in the README was measured and is reproducible from the repo.
- Every major decision is in `docs/decisions.md`; every phase has a study guide; I can explain every file.
- Released `v2.0.0` (code) and `models-v1` (detector weights).
