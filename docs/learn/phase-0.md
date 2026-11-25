# Phase 0: Safety, cleanup, foundation

## What we built and why

Before writing any feature we made the rebuild **safe** and set up the **foundation**:

1. **A safety net.** The old version is tagged `v1-original`, so any v1 file can be read back at any time with `git show v1-original:backend/app/utils/plates.py`. That is why we could delete v1 completely instead of keeping a `legacy/` folder.
2. **A clean slate.** The v1 FastAPI backend, Next.js frontend and their Docker files are gone. The academic report moved outside the repo, because it is not part of the product and should never be committed.
3. **Three empty-but-working packages:** `server/` (Express), `client/` (React + Vite), `anpr/` (Python). Each has a tiny piece of real code and one test, so lint, type-check, tests and Docker can all be proven before features arrive.
4. **A dev stack** (`docker-compose.yml`): Postgres, Mailpit (a fake mail server with a web inbox), the API and the web app.
5. **CI** (`.github/workflows/ci.yml`): every pull request lints, type-checks and tests all three packages, starts the whole Docker stack, and scans git history for secrets.

## Key concepts, simply

- **Git tag:** a permanent name for one commit. Branches move; tags don't. `v1-original` will always point at the last v1 commit.
- **Monorepo:** several projects in one repository. Here each package keeps its own dependencies and tools, so they stay independent.
- **Type-aware linting:** ESLint asks the TypeScript compiler about types, so it can catch things like an unhandled promise, not just style.
- **Health check:** a tiny endpoint (`/api/health`) that says "I'm alive". Docker and CI poll it to know when the service is ready.
- **Binding to 127.0.0.1:** a port bound to `127.0.0.1` is reachable only from your own machine. `0.0.0.0` means every network interface. Inside a container we must listen on `0.0.0.0`, but the compose file publishes the port on `127.0.0.1` only.
- **Secret scanning:** gitleaks searches every commit for things that look like keys or passwords. It runs on the whole history, because deleting a secret in a later commit does not remove it from history.

## Files to read, in order

1. `CLAUDE.md`: the full brief (the "spec").
2. `docs/PROGRESS.md`: where we are.
3. `docs/decisions.md`: why things are the way they are (D1–D7).
4. `.env.example`: every setting the system will have, with safe dev values.
5. `docker-compose.yml`: the four dev services and how they connect.
6. `server/src/index.ts`: the placeholder API, and the "only listen when run directly" trick.
7. `server/tests/health.test.ts`: testing an Express app without opening a port (supertest).
8. `client/vite.config.ts`: the dev proxy that makes `/api` same-origin.
9. `anpr/pyproject.toml`: Python packaging, ruff and pytest settings.
10. `.github/workflows/ci.yml`: the five CI jobs.

## Alternatives we rejected

- **Keep v1 in a `legacy/` folder** while rebuilding: the tag already keeps it, and a second codebase in the tree confuses search, lint and reviewers.
- **TypeScript 7:** newest, but typescript-eslint cannot use it for type-aware rules yet (D6).
- **npm workspaces / Turborepo:** extra tooling for only two Node packages (D1).
- **The gitleaks GitHub Action:** needs a licence key on organisation accounts; the Docker image does not (D7).

## Likely interview questions

1. **Why tag before deleting instead of just relying on git history?** A tag gives the old version a name you can find in a second: `git checkout v1-original`. You don't need to search the log for the right commit.
2. **Why is the ANPR worker not in docker-compose?** It runs at the gate (the edge), next to the camera, not on the server. The server only receives its HTTP posts.
3. **Why bind dev ports to 127.0.0.1?** So the dev database and mail inbox aren't open to everyone on the same Wi-Fi.
4. **What does `depends_on: condition: service_healthy` do?** Compose waits until Postgres passes `pg_isready` before starting the API, so the API doesn't crash on boot.
5. **Why does `index.ts` check `import.meta.url` against `process.argv[1]`?** So tests can import `createApp()` without the file also starting a real server.
6. **Why pin exact dependency versions?** Builds are reproducible: CI and every laptop install exactly the same code. Upgrades are deliberate commits.
7. **Why run secret scanning over the whole history?** A secret committed and then deleted is still in history and still leaked.
8. **Why is there no allowlist for `.env.example`?** An allowlist would also hide a real secret pasted there by mistake. Placeholders like `dev-only-change-me` don't trigger the rules anyway.
9. **What is the Vite proxy for?** In dev the browser talks to one origin (5173), and Vite forwards `/api` to the API. That matches production (one origin behind Caddy), so CORS isn't needed.

## Exercise

Add a `GET /api/version` endpoint that returns `{ "version": "0.0.0" }` (read it from `package.json`). Write the supertest test first, watch it fail, then make it pass. Then run `npm run lint` and `npm run typecheck`.
