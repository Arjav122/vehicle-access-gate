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
