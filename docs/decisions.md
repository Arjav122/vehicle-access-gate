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

## Deferred

- **Telegram approvals** (stretch): not built in Phase 4. The approval service already takes a `channel`, so the webhook only needs to call `residentDecides(…, "telegram")`.
- **Visitor email** ("gets an email with visit details"): comes with the notification outbox in Phase 5.
