# Progress

The brief is in [`CLAUDE.md`](../CLAUDE.md). Update this file at the start and end of every session.

| Phase | Name | Branch | Status | PR |
|---|---|---|---|---|
| 0 | Safety, cleanup, foundation | `phase-0-foundation` | 🟡 In progress: foundation built; waiting on Docker Desktop for the compose check, then push + PR | — |
| 1 | Server core, database, auth | `phase-1-server-core` | ⚪ Not started | — |
| 2 | Gate event engine | `phase-2-gate-events` | ⚪ Not started | — |
| 3 | ANPR worker | `phase-3-anpr-worker` | ⚪ Not started | — |
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
- [ ] Verify: `docker compose up --build` starts cleanly (blocked: Docker Desktop crashes on start on this machine)
- [ ] Verify: gitleaks scan of the full history (needs Docker)
- [ ] Owner: confirm the Supabase Postgres major version (D3)
- [ ] Push `main` + `phase-0-foundation` + tag `v1-original`, switch the GitHub default branch to `main`, open the PR, CI green (after owner OK)
