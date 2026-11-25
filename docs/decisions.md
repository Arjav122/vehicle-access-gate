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
