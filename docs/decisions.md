# Decisions

One section per decision: context, decision, alternatives, consequences. Newest at the bottom.

---

## D1. Rebuild as a monorepo with three packages

- **Context:** v1 was FastAPI + Next.js with ANPR inside the API process. The camera code (heavy ML) and the web API have very different needs.
- **Decision:** one repo, three independent packages: `server/` (Node API), `client/` (React), `anpr/` (Python edge worker). Each has its own dependencies, lint, tests and Dockerfile. No workspace tooling (npm workspaces, Turborepo, Nx).
- **Alternatives:** separate repos (harder to review one feature end to end); npm workspaces (only 2 of the 3 packages are Node, so little gain).
- **Consequences:** CI runs one job per package. Shared contracts cross package lines only through the OpenAPI file (server → client) and the gate-event HTTP contract (anpr → server).

## D2. Node.js for the API, Python only at the edge

- **Context:** the ML ecosystem (ONNX Runtime, OpenCV, PaddleOCR) lives in Python; the web side (real time, many small JSON endpoints, typed client) is a good fit for TypeScript.
- **Decision:** the server is TypeScript; Python runs only in the ANPR worker. They talk over HTTP (`POST /api/gate-events`). "The camera reads, the server decides": all plate repair and matching live in `server/src/services/plates.ts`.
- **Alternatives:** keep everything in Python (FastAPI); run OCR on the server (camera uploads video).
- **Consequences:** two languages to maintain, but each side is small and testable on its own; the worker can run offline and replay later.

## D3. Supabase is used only as PostgreSQL

- **Context:** the owner already hosts Postgres on Supabase.
- **Decision:** production `DATABASE_URL` = Supabase transaction pooler (port 6543, `?pgbouncer=true`), `DIRECT_URL` = direct/session URL (5432) for migrations. No Supabase Auth, client SDK or Row Level Security: the Node API owns auth and permissions. Local dev and CI use a `postgres:17-alpine` container.
- **Alternatives:** Supabase Auth (ties the auth design to one vendor and hides it from interviews); a local-only database.
- **Consequences:** locks (`pg_advisory_xact_lock`, `FOR UPDATE`, `SKIP LOCKED`) are used only inside transactions so they work through the transaction pooler. **To confirm:** the Postgres major version of the owner's Supabase project (Dashboard → Project Settings → Infrastructure). The dev container uses 17; if Supabase reports another major, change the image tag to match.

## D4. Default branch is `main`

- **Context:** the repo's default branch was `master`; the brief and CI use `main`.
- **Decision:** renamed `master` → `main` locally before the first v2 pull request. The owner switches the GitHub default branch (Settings → General → Default branch) after pushing `main`.
- **Alternatives:** keep `master` and edit the brief.
- **Consequences:** old clones need `git branch -m master main && git fetch && git branch -u origin/main main`.

## D5. Detector weights: third-party model now, own model later

- **Context:** the brief assumed "my trained YOLO11 weights". In fact v1 downloads a third-party model at run time: Hugging Face `DavidDrill69/yolov11-license-plate-detection`, file `license-plate-finetune-v1n.pt`. No weights were ever in the repo, and the model's licence is not stated (Ultralytics YOLO11 fine-tunes are usually AGPL-3.0).
- **Decision (Phase 3):** pin that model to an exact Hugging Face revision and verify its SHA-256 on download, without re-hosting it. Train our own detector in `anpr/notebooks/train_detector.ipynb` on openly licensed data; only a model we trained is published as the `models-v1` GitHub Release.
- **Alternatives:** re-publish the third-party weights as `models-v1` (licence unclear, and it would misstate who trained them); skip ML training entirely.
- **Consequences:** the README never calls the third-party model "ours". The eval tables in Phase 3 compare both models on the same held-out set.

## D6. Tool versions (checked 2026-11-25)

- **Context:** the brief asks for current stable versions, checked at the start.
- **Decision:**
  - Node 26 (Active LTS) in Docker and CI; `engines: >=24` so Node 24 (Maintenance LTS) still works locally.
  - TypeScript **6.0.3**, not 7.0.2: typescript-eslint 8.74 (needed for type-aware lint) supports TypeScript < 6.1 only. Move to 7.x when typescript-eslint supports it.
  - Express 5.3, Vitest 5.1, ESLint 10, Vite 8, React 19.3, Prettier 3.10.
  - Python 3.12 (as the brief says; still receives security fixes until 2028-10). Newer Pythons exist (3.13–3.15), but PaddlePaddle 3.3 ships wheels only up to 3.13, so 3.12 is the safe choice until Phase 3 confirms the OCR stack on something newer. Ruff 0.17, pytest 9.2.
  - Postgres 17 (see D3), Mailpit 1.34, gitleaks 8.30.
- **Alternatives:** the newest of everything (breaks type-aware lint today).
- **Consequences:** exact versions are pinned in `package.json` and lock files; Dependabot or a manual bump each phase keeps them current.

## D7. Secret scanning runs the gitleaks image directly

- **Context:** the official `gitleaks/gitleaks-action` requires a licence key for organisation accounts.
- **Decision:** CI runs `ghcr.io/gitleaks/gitleaks:v8.30.1` with `docker run` over the full history, using `.gitleaks.toml` (default rules + a rule for `vd_` device keys). No path allowlist, so `.env.example` is scanned too and must hold only obvious placeholders.
- **Alternatives:** the GitHub Action; GitHub's own secret scanning (good extra layer, enable it in repo settings).
- **Consequences:** same behaviour on personal and organisation accounts; one less third-party action with repository access.

## D8. Prisma 7 with the `pg` driver adapter

- **Context:** the brief picks Prisma. Prisma's npm `latest` tag currently points at a release candidate (8.0.0-rc), and Prisma 7 changed setup: the database URL lives in `prisma.config.ts`, and the client runs through a driver adapter.
- **Decision:** Prisma **7.10.1** (stable) with `@prisma/adapter-pg`. The generated client goes to `server/generated/` (gitignored, created by `npm install`), outside `src/`, so Docker's live-edit mount of `src/` cannot hide it. `prisma.config.ts` reads `DIRECT_URL` and deliberately loads no `.env` file. The owner's old v1 `.env` points at Supabase, and a stray `migrate` must never reach it.
- **Alternatives:** Prisma 8 RC (not stable); Drizzle or Kysely (fine, but the brief chose Prisma, and its schema file is easy to explain).
- **Consequences:** the `pg` adapter sends plain queries (no named prepared statements), so it works through Supabase's transaction pooler. Locks (`FOR UPDATE`, advisory locks) are only ever used inside transactions.

## D9. Prisma enums instead of text + CHECK

- **Context:** the brief allows either and asks for the choice to be recorded.
- **Decision:** Prisma enums with lower-case values (`'pending_approval'`, …). They become Postgres enum types.
- **Alternatives:** `text` columns with CHECK constraints (easier to remove values, but no generated TypeScript types).
- **Consequences:** the database and TypeScript share one list of values, and invalid values fail in both places. Adding a value is a one-line migration; removing one needs a type rebuild (rare).

## D10. One declaration per endpoint (`defineRoute`)

- **Context:** each endpoint needs input validation, a role check and API docs. Writing them separately lets them drift apart.
- **Decision:** `server/src/openapi.ts` has `defineRoute(router, spec, handler)`. The spec names the path, roles, Zod schemas and responses. One declaration wires up validation (422), the role check (401/403) and the OpenAPI entry. It also records the route in `routeTable`, and `tests/rbac.test.ts` walks that table to try every role on every route, including routes added later.
- **Alternatives:** separate middleware per route plus hand-written OpenAPI; a framework like NestJS or tRPC (more magic, harder to explain).
- **Consequences:** a route cannot ship without docs or a role check. Simple CRUD stays in the route files; real business rules go to `services/`.

## D11. Auth details and in-memory rate limits

- **Context:** brief §10.7.
- **Decision:** passwords use argon2id, and unknown emails are checked against a dummy hash, so every failure looks the same. Tokens are signed with `jose` using HS256 only, with issuer/audience checks and required claims `sub`/`type`/`jti`/`exp`. Access tokens last 15 minutes. Refresh tokens last 7 days, are stored by `jti`, and are rotated on each use with the row locked `FOR UPDATE`; reusing a spent one revokes all of that user's sessions. The user is loaded from the database on every request. Login limits: 20 per minute per IP and 10 per minute per account, counted in memory.
- **Alternatives:** sessions stored server-side (fine, but the brief asks for JWT); Redis-backed limits (see D12).
- **Consequences:** a single server keeps exact counts. A restart resets the counters, which is acceptable for login throttling.

## D12. No Redis (yet)

- **Context:** the owner asked whether the project should have Redis for caching. Brief §5 says to keep one server instance and use Postgres.
- **Decision:** no Redis in v2.0. Postgres already does each job Redis would: debounce and locking (advisory locks), job claiming (`FOR UPDATE SKIP LOCKED`) and idempotency (unique keys). No endpoint is slow enough to need a cache. Login counters live in memory (D11).
- **When Redis would be added** (scaling out to 2+ API instances): the Socket.io Redis adapter (so events reach every instance), Redis-backed rate limits, BullMQ for jobs, and Redis for debounce. Possibly a cache for analytics if those queries get slow.
- **Consequences:** one fewer service to run, secure and explain. Adding Redis later touches `realtime.ts`, `middleware.ts` (limits) and `jobs.ts`, not the business logic.

## D13. Tests use a real Postgres test database

- **Context:** brief §14 asks for tests against a real Postgres, isolated per test.
- **Decision:** Vitest creates `vehicle_access_test` (it refuses any database whose name does not end in `_test`) and applies the migrations once. Every test truncates all tables first, and test files run one after another. CI runs the same tests against a `postgres:17-alpine` service container. Coverage of `services/` must stay at least 80% (enforced in `vitest.config.ts`).
- **Alternatives:** an in-memory or SQLite fake (would not exercise CHECK constraints, partial indexes or row locks); one database per test file (faster in parallel, more setup).
- **Consequences:** the tests catch constraint and locking bugs. The suite stays fast (about 10 seconds) because the schema is created once.

## D14. Plate repair: score every layout, small shape penalties

- **Context:** brief §10.1. OCR confuses look-alike characters (O/0, I/1, B/8, …), and real reads often carry the HSRP "IND" mark.
- **Decision:** `repairPlate` in `server/src/services/plates.ts` tries every legal layout for the read's length: standard (state + 1–2 digit district + 0–3 letter series + 1–4 digit number) and BH (year + BH + 4 digits + 1–2 letters). A character of the wrong kind is swapped for its look-alike at a cost of 1. Score = swaps + shape penalties (3-digit number 0.3, shorter 0.5; 1- or 3-letter series 0.2, none 0.4). The lowest score wins. More than 3 swaps means unreadable. "IND", and the misreads `INO`/`IN0`/`1ND`/`LND`, are tried with and without at both ends. Series letters never become I, O or Q.
- **The one large penalty:** a 1-digit district outside Delhi costs **1.1**, a little more than one swap. With a "small" penalty, `UP1ZAB1234` would be accepted as a rare plate with district 1 and series `ZAB`, instead of the far more likely `UP12AB1234`. This is the trap in brief §17.
- **Alternatives:** a regex per layout plus hand-written special cases (grows without limit); a learned model (no labelled data yet; Phase 3 collects it through guard corrections).
- **Consequences:** 84 table-driven tests pin the behaviour. Typed plates (admins, guards) are only validated, never repaired: a person's input is taken literally.

## D15. Snapshot storage: local folder now, S3-compatible with deployment

- **Context:** brief §10.8 asks for `local` (default) and an optional S3-compatible store (e.g. Supabase Storage).
- **Decision:** Phase 2 implements the local store (a Docker named volume, `snapshots`). Setting `SNAPSHOT_STORAGE=s3` is refused at startup with a message pointing here. The S3 store is added in Phase 8, when we know the hosting and can test against a real bucket.
- **Why not now:** S3 code tested against nothing would be untested code shipped as a feature (brief rule 5). The storage interface (`saveSnapshot` / `loadSnapshot` / `deleteSnapshot`, keys `yyyy/mm/dd/<eventId>.<ext>`) is already what an S3 store needs.
- **Consequences:** images are recognised by their first bytes (JPEG, PNG or WebP; anything else is a 422). Keys are validated, so a key can never reach outside the snapshot folder.

## D16. Gate-event ingest: one transaction, an advisory lock, a two-sided debounce window

- **Context:** brief §10.2. Cameras retry, the same car is read many times while it waits, and the edge worker replays buffered reads after an outage.
- **Decision:** each read is handled in one transaction that first takes `pg_advisory_xact_lock(hash(device | plate))`. That serialises work on the same car at the same camera; the lock is released at commit, so it is safe through Supabase's transaction pooler. Inside the lock:
  1. `event_hash = sha256(device | repaired plate | capturedAt)` already stored → `duplicate`. The unique index is a backstop.
  2. An event for that device and plate whose `[captured_at − 30 s, last_seen_at + 30 s]` window contains this read's `capturedAt` → push its `last_seen_at` forward → `debounced`.
  3. Otherwise → create the event and apply the decision.
- **Bug caught while building:** the first version checked only `last_seen_at ≥ capturedAt − 30 s`. A read from 09:00 replayed after a 10:00 event of the same plate would have been folded into the 10:00 event. The window is now two-sided, and a test replays an old read to pin it.
- **Matching order:** watchlist (even for low confidence, so the guard is warned) → low confidence or unreadable (review queue) → residents' vehicles and visitors expected *at that lane* (approved visits at entry; inside, overstayed or escalated visits at exit) → unknown. Only `(plate, id)` pairs within ±1 length are loaded (brief §17). Exact beats fuzzy; two equally close plates → `ambiguous` → review queue.
- **Never drop a car:** if a visit changes state between matching and the camera's move (a guard just closed it), the read is kept and sent to review instead of failing the upload.
- **Consequences:** a scripted sequence of reads gives the same events, visits, alerts and review items every time (`server/tests/gateEvents.test.ts`).

## D17. Detector: the publisher's pinned ONNX file, downloaded, never re-hosted

- **Context:** D5 chose to keep v1's third-party detector for now. Checking it in Phase 3: the Hugging Face repo `DavidDrill69/yolov11-license-plate-detection` is licensed **AGPL-3.0**, and it already publishes ONNX exports next to the `.pt` files.
- **Decision:** `python -m anpr.download_model` downloads `license-plate-finetune-v1n.onnx` (10.5 MB) from that repo at commit `f8fb9d5`, and checks its SHA-256 (`693133a1…51d6`) before using it. It downloads atomically through a `.part` file, skips the download when the right file is already there, and prints the licence. No PyTorch or Ultralytics is needed anywhere, not even for a one-time export. The model takes 640×640 RGB scaled to 0–1 and returns `(1, 5, N)`: centre x, centre y, width, height, score, with no NMS inside. Letterboxing, decoding and NMS are NumPy code in `detector.py`.
- **Consequences:** our code stays MIT, and the weights stay with their AGPL publisher. The README says plainly that the default detector is third-party AGPL. `models-v1` is reserved for a detector we train ourselves (`notebooks/train_detector.ipynb`). CI caches the file and runs real-detector tests on synthetic plate images.

## D18. OCR: PaddleOCR mobile models, oneDNN off, installed as an extra

- **Context:** brief §11.3. Three things found while testing PaddleOCR 3.7 / PaddlePaddle 3.3.1 on Windows with Python 3.12:
  1. With default settings, inference fails: `ConvertPirAttribute2RuntimeAttribute not support`. This is PaddlePaddle's oneDNN path not supporting the new PIR model format.
  2. The default "medium" PP-OCRv6 models work with oneDNN off, but are slow.
  3. Plates come back as several text pieces ("22", "BH", "1234AA"); sorting them by their top edge alone gave `123422BHA`.
- **Decision:** `enable_mkldnn=False` with the `PP-OCRv5_mobile_det` / `PP-OCRv5_mobile_rec` models. Pieces are read in reading order: grouped into rows (a new row starts when a piece's top is more than half a line height lower), rows top to bottom, each row left to right. A regression test covers the `22BH1234AA` case. PaddleOCR is an optional `[ocr]` extra: CI and quick installs run the worker with a stand-in OCR.
- **EasyOCR:** not installed. Brief rule: keep it only if it beats PaddleOCR by ≥ 2 points on the same held-out photos. `notebooks/compare_ocr.ipynb` runs that comparison once there is real data.
- **Measured on this laptop's CPU (synthetic plates; a speed check, not an accuracy claim):** about 1.1 s per crop for OCR, about 60 ms for the detector. So live analysis runs near 1 frame/s, not the configured 5. Frame voting still works: a car needs ~3 s in view for 3 agreeing reads, or it is sent after the 2 s gap. Faster options for later: recognition-only on single-line plates, or a GPU.

## D19. Worker structure: one pipeline, one buffer per lane, a script for webcam keys

- **Context:** brief §11. The CLI and the webcam preview page both need "frame → plate → OCR → vote → send".
- **Decision:**
  - `anpr/pipeline.py` holds that chain once (the one file added to the §7 layout), and `Courier` delivers for one lane.
  - Every voted read is written to the lane's SQLite buffer (`buffer-entry.sqlite`, `buffer-exit.sqlite`; WAL, `synchronous=FULL`) **before** sending, and the queue drains oldest-first. An outage stops the drain without losing anything; a permanent 4xx moves the read to a `rejected` table so it cannot block the queue.
  - `server/prisma/webcamDevices.ts` (`npm run webcam:devices`) creates or reuses gate "Laptop webcam" with an entry and an exit device, rotates both keys, and writes them into `anpr/.env`, keeping every other line. Like the seed, it refuses a non-local database.
- **Consequences:** a recording replayed twice produces the same capture times, so the server's idempotency turns the second run into `duplicate`s. The simulator (Phase 7) must skip the "Laptop webcam" devices (brief §13).

## D20. Approvals: one locked row, first answer wins, the clock checked twice

- **Context:** brief §10.4. Two residents of a flat may tap at the same moment; answers can arrive after the timeout; the guard needs a fallback.
- **Decision:** one `approvals` row per visit (unique `visit_id`). Every answer locks it `FOR UPDATE`, so concurrent taps are served one after the other:
  - **Same answer again:** 200, nothing changes.
  - **Different answer:** 409; the first answer counts.
  - **Late answer:** each answer checks the clock itself (`now ≥ expires_at`), marks the approval `timed_out`, and returns 409 "the guard decides now". It doesn't wait for the job.
  - **Overdue approvals:** a node-cron job every 15 s (`approvals.expire`, `FOR UPDATE SKIP LOCKED`) marks them `timed_out` and tells staff and the flat in real time.
  - **The guard's decision:** allowed (`POST /visits/:id/decision`) only once the time is up; while residents can still answer, the guard gets 409 with the seconds left. The approval stays `timed_out` and records the guard as the decider (`channel: guard`).
  - **The waiting car:** if the guard registered the visitor against the waiting car's read, approving lets that car in at once (the read becomes the visit's entry). Otherwise the visit waits as `approved` for a camera read or a manual entry.
- **Alternatives:** optimistic version numbers (also fine, but row locks are simpler to explain); only the job enforcing the timeout (a late tap could slip in between runs).
- **Consequences:** a race test proves two simultaneous answers produce exactly one decision and one history row. Telegram answers (stretch) will call the same function with `channel: telegram`.

## D21. Guest passes: HMAC'd one-time codes, uses counted in SQL

- **Context:** brief §10.5.
- **Decision:**
  - **What a pass is:** a plate and/or an 8-character code from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, 1/I/L, so it can be read aloud). The code is returned once and stored as HMAC-SHA256 with a key derived from the server secret.
  - **Counting uses:** a single conditional `UPDATE … SET use_count = use_count + 1 WHERE use_count < max_uses AND revoked_at IS NULL AND valid_from <= t AND valid_until > t`. A pass can never be over-used, even when two gates race. The CHECK `use_count <= max_uses` is the backstop.
  - **At the gate:** a plate match creates the visit already `approved` and moves it `inside` with the camera's capture time. Passes are candidates on the entry lane only. The guard can also type a code (`POST /guest-passes/redeem`).
  - **Wrong answers:** an unknown code is 404; an expired, not-yet-valid, used-up or revoked pass is 409 with the reason in words.
- **Consequences:** guards never see codes, and residents see a code only at creation. Phase 6's resident app must show it prominently once ("code shown once").

## D22. Real time: Socket.io rooms, publish after commit, events tell screens to refetch

- **Context:** brief §9, §12.
- **Decision:**
  - **Rooms:** one Socket.io server on the same HTTP server and origin (`/socket.io`, proxied by Vite in dev and Caddy in prod), with rooms `staff` and `user:<id>`.
  - **Auth:** the access token goes in the handshake (`auth.token`); a bad or expired token is refused with `unauthorized`.
  - **Events:** `{ type, at, data }`, sent by the route after its transaction commits. A failed send is logged, never fatal.
  - **Audiences:** gate events and alerts go to staff only. Approval and visit events go to staff plus every active resident of that flat (looked up per event), so a neighbour never sees another flat's visitors.
- **Alternatives:** server-sent events (one-way only); polling (slower and wasteful); the Redis adapter (only needed with 2+ instances, D12).
- **Consequences:** the client treats events as "refetch this query" signals (brief §12), so a missed event only delays a screen until the next refetch or reconnect.

## D23. Notifications: an outbox table, a dispatcher with SKIP LOCKED, retries with backoff

- **Context:** brief §10.6. Emails must never be sent twice, never be lost when SMTP is down, and must not slow the request that caused them.
- **Decision:**
  - **Queue:** business steps only `INSERT` a `notifications` row inside their own transaction, with an idempotency key such as `visit:<id>:overstay_reminder:resident:<userId>`, and `ON CONFLICT (idempotency_key) DO NOTHING`. Re-running a step queues nothing new, and an email exists only if the change that caused it was committed.
  - **Dispatch:** `notifications.dispatch` (every minute) claims one due row at a time with `FOR UPDATE SKIP LOCKED`, sends it through Nodemailer and marks it `sent`. Two dispatchers side by side never take the same row.
  - **Retries:** a failure sets `next_attempt_at = now + 1, 2, 4 … 60 min` and keeps the last error. After 5 attempts the row is `failed`, and it stays visible in the admin delivery log (`GET /notifications`).
  - **Templates:** every email has an HTML and a plain-text part from one small layout, and every value is HTML-escaped. Times are shown in IST. Mailpit catches all mail in development.
- **Alternatives:** sending inside the request (slow, and a rollback can't unsend an email); a queue such as BullMQ or Redis (one more service for a few emails a minute, D12).
- **Consequences:** delivery is "at least once" at the SMTP level. If the server crashes after SMTP accepts the mail but before the row is marked sent, that one email can go again. The idempotency key prevents every other duplicate.

## D24. Escalation ladder: pure decisions from a passed-in clock, idempotent writes

- **Context:** brief §10.6. Visitors who stay past their limit are followed up in steps, and the job must be safe to run twice, late or after an outage.
- **Decision:**
  - **Pure decisions:** `dueSteps(visit, now)` says which steps are due: `overstay` at the limit, `reminder` at +30 min, `escalate` at +60 min. It is pure and table-tested.
  - **Applying them:** `runLadder(now)` applies the due steps per visit in one transaction, with the visit row locked `FOR UPDATE`:
    - **overstay:** `transitionVisit("overstay")` timed at the limit itself, then emails the visitor and each resident.
    - **reminder:** emails the residents again.
    - **escalate:** `transitionVisit("escalate")` timed at +60 min, then one `escalation_tasks` row ("call the resident", unique per visit).
  - **Why it's idempotent:** the state machine refuses a second overstay or escalate, email keys are unique and the task is unique per visit. After an outage, one run does every missed step once, in order, with the history showing when each step was *due*.
  - **The guard's side:** the task list (`GET /escalations`) shows residents' full phones (the guard must dial). `POST /escalations/:id/resolve` records `reached` or `not_reached` once. Any exit closes an open task as `vehicle_left`.
- **Alternatives:** scheduling one timer per visit (lost on restart); storing a "next step at" column (more state to keep correct than recomputing from `expected_exit_at`).
- **Consequences:** tests drive the whole ladder with a mocked clock and prove each step happens exactly once, including two runs racing.

## D25. Reconciliation and retention as nightly SQL jobs

- **Context:** brief §3, §10.6. Camera data drifts (missed reads), and personal data must not be kept forever.
- **Decision:**
  - **Reconciliation (03:00 IST):** one `INSERT … SELECT … ON CONFLICT (kind, subject_id) DO NOTHING` per finding:
    - an exit of a resident car that closed no entry;
    - a resident entry that no exit closed and that a later entry of the same car superseded (a parked car's one open entry is normal, so it is not flagged);
    - a visit still inside more than `RECONCILIATION_STALE_HOURS` after its limit.
    - Each finding is flagged once. Admins review the list and mark items resolved.
  - **Retention (03:30 IST):** past `visitorRetentionDays` (settings, default 90):
    - visitors' name, phone and email are erased (`purged_at` set), unless a visit of theirs is still open; the anonymised visit history stays for analytics;
    - sent and failed emails are redacted;
    - snapshots are deleted from storage in batches of 200.
- **Alternatives:** deleting visitor rows (would break visit history and analytics); fixing drift automatically (a guess could hide a real problem, so a person decides).
- **Consequences:** both jobs are safe to re-run. `demo.nightlyReset` (04:00) arrives with demo mode in Phase 7.

## D26. Frontend architecture: one React app, lazy role areas, the server is the only store

- **Context:** brief §12. Three very different users (guard at a gate, resident on a phone, admin at a desk) share one codebase, and the screens must stay correct while events arrive live.
- **Decision:**
  - One Vite + React app with role-checked, lazy-loaded areas (`/guard`, `/resident`, `/admin`); a resident's phone never downloads the admin charts.
  - All server data goes through TanStack Query. No global store, no copies.
  - One Socket.io connection per tab. An event *invalidates* the queries that show that data, and those screens refetch. Nothing patches cached data by hand. After a reconnect everything is refetched, because events sent while offline are lost.
  - API types are generated from the server's OpenAPI (`npm run openapi` → `client/openapi.json` → `npm run api:types`). CI fails if either file drifts, so a renamed field breaks the build, not the guard's screen.
  - The admin resource tables (flats, residents, vehicles, guards, gates, cameras, watchlist) are one generic component driven by a config per resource. It uses a small loosely typed request helper; everything else uses the typed client.
- **Alternatives:** Next.js (server rendering adds little behind a sign-in; v1 used it); Redux/Zustand (a second copy of server data that events would have to keep in sync); patching the cache from socket payloads (two code paths that can disagree).
- **Consequences:** an event costs one small refetch. The UI can't drift from the server's truth, and missed events heal on the next refetch.

## D27. Design system: tokens, one accent, the PlateChip

- **Context:** brief §12. Calm and modern, accessible, light + dark, and status colours that never carry meaning alone.
- **Decision:**
  - Colours are CSS variables on `:root` / `.dark`, mapped into Tailwind v4 with `@theme inline`.
  - Neutral greys, plus one blue accent taken from the IND strip of an HSRP plate (validated for chart contrast in both themes).
  - 1 px borders, no shadows; IBM Plex Sans with tabular numbers.
  - State colours (ok / warn / danger / info) appear only with a word and an icon (`VisitStatusBadge`, `MatchBadge`).
  - Components are shadcn-style files built on Radix primitives, which provide focus traps, Esc and arrow-key behaviour.
  - The **guard console has its own theme, dark by default** (night shifts, glare at the gate), with touch targets of at least 44 px; the resident app is mobile-first with a bottom tab bar.
  - **PlateChip** draws every plate as a mini HSRP plate, grouped as printed (`UP16 AB 1234`, `22 BH 1234 AA`). It stays white in dark mode and is read out character by character by screen readers.
  - Charts are single-series in the accent colour, each with a title, a tooltip and a "View as table" switch. Two measures of different size get two charts, never one chart with two y-axes.
- **Alternatives:** a component kit with its own look (Material/Ant: heavier, and harder to make feel like this product); colour-only status dots.
- **Consequences:** a theme switch is one class on `<html>`. Adding a component means copying the pattern, not adding a dependency.

## D28. Client auth: in-memory tokens mirrored to localStorage, single-flight refresh

- **Context:** brief §10.7 and §17. Refresh tokens are single-use, and reusing a revoked one signs the user out everywhere.
- **Decision:**
  - The token store keeps the pair in memory and mirrors it to localStorage, so a reload stays signed in.
  - A 401 triggers **one** shared refresh: parallel requests wait for the same promise, then retry once. A refused refresh signs out.
  - Signing in writes the user into the `["me"]` query (`setQueryData`) and drops the previous user's lists, instead of clearing the whole cache. That avoids the demo role-switch flash.
  - `?next=` is followed only inside the user's own area, so it can't be used as an open redirect.
  - Snapshots and the CSV export are fetched with the token as blobs, because an `<img src>` can't send a header.
- **Alternatives:** httpOnly refresh cookie (safer against XSS, but needs CSRF protection and a cookie path that works behind the Vite proxy and Caddy; noted for Phase 7 hardening); refreshing on a timer (still needs the 401 path).
- **Consequences:** an XSS bug could read the tokens. React escapes everything it renders and the app never injects raw HTML; a Content-Security-Policy on the served app comes with Caddy in Phase 8. Access tokens live 15 minutes.

## D29. Analytics in SQL, IST, and demo logins

- **Context:** brief §3, §9, §13. The admin needs busiest hours, average visit, overstay rate, frequent visitors and vehicles inside. The public demo needs one-click logins.
- **Decision:**
  - `GET /analytics/overview?days=` runs a few read-only SQL queries, bucketed by **IST** hour and day (`AT TIME ZONE 'Asia/Kolkata'`). Every hour and every day is returned, with zeros where nothing happened.
  - Overstay rate = visits that *entered* in the window and ever reached `overstayed` ÷ visits that entered.
  - "Inside now" = visitors in `inside / overstayed / escalated`, plus resident cars whose **latest** camera read was an entry.
  - `GET /demo` returns the three demo accounts and the demo password, **only** when `DEMO_MODE=true` (404 otherwise). Dev compose turns it on; production keeps it off unless deliberately enabled for the public demo.
  - `POST /demo/reset` and the nightly reset come with the simulator in Phase 7.
- **Alternatives:** pre-aggregated tables (unnecessary at one society's volume); computing in JavaScript (moves every row over the wire).
- **Consequences:** the numbers are always live and consistent with the lists. The demo password is public by design in demo mode, so a real society must never run with `DEMO_MODE=true`.

## D30. Seed history goes through the services

- **Context:** brief §13. Screens and charts need 14 days of believable history, and the jobs must find nothing left to repeat.
- **Decision:**
  - The seed replays history through the real code paths: `ingestRead` for camera reads, `registerVisit`, `residentDecides` / `guardDecides`, `transitionVisit`, and `reviewEvent` for corrected blurry reads.
  - Every resident car starts parked inside (one entry the evening before the window), so the first morning exit pairs correctly.
  - About 1 in 8 visitors overstays, about 1 in 10 is denied or decided by the guard, regular visitors return, and watchlist hits are acknowledged.
  - A "right now" state is left for the jobs and the demo: cars inside, two overstays (the ladder runs on them live), a visitor waiting for the demo resident (A-101), an unknown car at the barrier, two unclear reads, one open watchlist alert and a guest code.
  - Visits now store the time they happened as `createdAt`, and `reviewEvent` takes the clock as a parameter, so history isn't stamped "now".
- **Alternatives:** inserting rows directly (fast, but would skip pairing, approvals and history rows, and the jobs would then "repair" the fake data).
- **Consequences:** a full reseed takes about 90 seconds and produces about 1,450 reads and 200 visits. The people and plates are the same every run; times are relative to when you run it.

## D31. Tooling notes for Phase 6

- **openapi-typescript 7.13 declares a peer of TypeScript 5**, while the repo uses TypeScript 6. It is a build-time generator only, so `client/package.json` overrides its peer to our TypeScript. The generated `schema.d.ts` type-checks under TS 6, and CI regenerates it to prove it still matches. Revisit when a TS 6-compatible release ships.
- **Playwright arrived one phase early**, for reproducible screenshots (`npm run screenshots` signs in for real and captures every main screen into `docs/assets/`). Phase 7 adds the three end-to-end journeys to the same setup.

## D32. Demo reset: the seed as a function, run in the background

- **Context:** brief §13. A public demo gets messy (deleted vehicles, half-finished visits), so it needs a one-click and a nightly way back to a known state.
- **Decision:**
  - `prisma/seed.ts` exports `emptyDatabase()` and `seedSociety({ history })`. The CLI, the demo reset and the tests all use them. The random generator is re-seeded on every call, so a reset in a long-running server gives the same people and plates.
  - `POST /demo/reset` (admin, `DEMO_MODE=true` only, otherwise 404) answers **202** at once and runs the reset in the background, because a full reset takes about 90 s. A second request while it runs gets **409**. `GET /demo` reports `resetting`.
  - The client signs the admin out and shows a notice on the login page, which polls every 5 s until signing in works again.
  - `demo.nightlyReset` runs at 04:00 IST in demo mode. While any reset runs, the other jobs skip their turn.
  - `{ "history": false }` gives a quick reset (seconds) without the 14 days.
- **Alternatives:** a reset inside the request (the browser would wait 90 s, and a proxy could time it out); restoring a database dump (fast, but the "right now" state would go stale, while the seed computes it relative to now).
- **Consequences:** a reset signs everybody out (accounts are re-created) and deletes every device, including a laptop webcam's: run `npm run webcam:devices` again afterwards. The simulator notices the 401s and starts over by itself.

## D33. Traffic simulator: a separate process that only uses the public API

- **Context:** brief §13. The deployed demo must look alive at any hour, and must exercise the same code paths real users do.
- **Decision:**
  - `src/simulator.ts` runs as its own process from the server image (`npm run simulator`, compose profile `simulator`). It imports nothing that touches the database.
  - It signs in as the demo admin (to rotate the keys of the cameras it uses), the guard and residents (tokens cached and refreshed, so it stays under the login rate limits). It posts camera reads with device keys.
  - **Traffic:** arrivals are a Poisson process. The rate follows the IST time of day (2/min in the 8–10 am and 6–9 pm rush, 0.6/min in the day, almost none at night), or a fixed `--rate`.
  - **Shares (§13):** 50% resident cars in or out, 30% unknown visitors (80% approved, 10% denied, 10% ignored so the guard decides after the timeout), 7% guest passes, 10% blurry reads, 3% watchlist (at most once per 45 min).
  - About 1 in 8 visitors overstays by **real** minutes even at `--speed > 1`, so the real escalation ladder runs. Normal stays and reaction times are divided by `--speed`.
  - A simulated guard does rounds every minute: it corrects the blurry reads it caused (it knows the true plate), dismisses others, acknowledges old alerts, resolves call tasks, decides timed-out visitors, and checks out long-forgotten ones.
  - It never touches cameras named in `--leave-devices` (default "Laptop webcam"). On a 401 (keys or accounts gone after a demo reset) it bootstraps again.
  - Flags: `--api --speed --seed --minutes --rate --leave-devices`.
- **Alternatives:** writing rows straight into the database (fast, but it would bypass validation, pairing, real time and the jobs, so the demo would show a fake); generating traffic inside the API process (the demo would then rely on code that a real society would never run).
- **Consequences:** the simulator is also a black-box test of the API: a test runs it against a real server for a minute, resets the demo underneath it and checks that it carries on. Behind a reverse proxy the login limit is per IP, so the proxy must forward client IPs (Phase 8, `trust proxy`).

## D34. End-to-end tests: three journeys against the real stack, in the compose CI job

- **Context:** brief §14. Unit and API tests can't prove that a camera read reaches the guard's screen live, or that a resident's tap on a phone moves the car inside.
- **Decision:**
  - Playwright runs against `docker compose` (browser → Vite → API → Postgres, Socket.io, Mailpit). Each run creates its own two cameras through the admin API and signs in through the login page.
  - **(1) Resident car:** a read with an OCR look-alike is repaired, and the guard sees "entry logged" live, then "exit logged".
  - **(2) Unknown visitor:** the guard registers the car from the arrival, the Register button disappears, the resident approves on a phone-sized second browser, and the guard sees the car inside; the exit camera closes the visit.
  - **(3) Overstay:** limit → Overstayed → call task with the resident's number → Reached, plus the overstay email is checked in Mailpit's API.
  - Journey 3 needs short time limits, so `VISIT_LIMIT_CAB_MINUTES`, `OVERSTAY_REMINDER_MINUTES` and `OVERSTAY_ESCALATION_MINUTES` can be overridden in compose. CI sets 1 / 1 / 2. Locally the journey skips itself with instructions if the limits are normal.
  - The journeys run in the existing compose job (one image build), after the smoke test; the Playwright report is uploaded on failure.
- **Alternatives:** a fake clock in the server for e2e (a test-only code path in production code); mocking the API in the browser (would test nothing that matters here).
- **Consequences:** about 4 minutes of CI, almost all of it journey 3 waiting for real minutes to pass. Client unit coverage thresholds (75% lines, statements and functions, 60% branches) cover `src/lib` and `src/components/ui`; the screens are covered by these journeys.

## D35. Hardening review (Phase 7)

- **Context:** brief §10.7, §10.9. Most protections were built with the features they protect; Phase 7 checks them against the brief.
- **Already in place and tested:**
  - request ids (kept if safe, else a new UUID, echoed and logged);
  - helmet headers, with `X-Powered-By` removed;
  - CORS allow-list;
  - 1 MiB JSON limit (413), and camera uploads at snapshot max + 64 KB (413 for oversize, 422 for non-images);
  - login limits per account (10/min) and per IP (20/min), camera limit per key (600/min), all with 429 + `Retry-After`;
  - argon2id with a dummy hash for unknown emails;
  - pinned-algorithm JWTs, rotating single-use refresh tokens with reuse detection, every route × every role.
- **Added now:** tests for the per-IP login limit and the per-camera limit. The camera limit counts by key hash even for unknown keys, so guessing keys is throttled too.
- **Deferred:**
  - `trust proxy` + CSP for the served app with Caddy (Phase 8). Without `trust proxy`, every user behind the proxy would share one IP for rate limiting.
  - The httpOnly refresh-cookie idea (D28) stays a documented alternative: moving the refresh token to a cookie needs CSRF protection and adds little while the access token must still live in JavaScript.
  - Prometheus metrics and a load test (stretch) are not built.

## Deferred

- **Telegram approvals** (stretch): not built in Phase 4. The approval service already takes a `channel`, so the webhook only needs to call `residentDecides(…, "telegram")`.
- **Visitor email** ("gets an email with visit details"): done in Phase 5. An approved visitor with an email gets a "visit approved" message (D23).
- **`demo.nightlyReset` job:** done in Phase 7 (D32).
- **Demo reset** (`POST /demo/reset`, the admin "Reset demo" button, `demo.nightlyReset`): done in Phase 7 (D32).
- **Hindi toggle and Telegram link in the resident profile** (stretch): not built; the profile says Telegram is planned.
- **httpOnly refresh cookie** instead of localStorage: reviewed in Phase 7 (D35), kept as a documented alternative.
- **Prometheus `/metrics` and a load test of gate-event ingestion** (stretch): not built in Phase 7; no performance numbers are claimed.
- **`trust proxy` and a CSP for the served app:** Phase 8, with Caddy (D35).
