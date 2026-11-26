# Phase 7: Simulator, hardening, end-to-end tests

## What we built and why

1. **Demo reset** (`prisma/seed.ts`, `server/src/routes/demo.ts`, `jobs.ts`, admin Settings): the
   seed became a function. An admin can press "Reset demo", and in demo mode it also happens
   every night at 04:00 IST. It runs in the background and the login page says when it is done.
2. **Traffic simulator** (`server/src/simulator.ts`): a separate program that plays cameras,
   guards and residents through the public API, so the demo looks alive at any hour.
3. **Hardening review**: checked every protection the brief asks for. Most existed already; we
   added tests for the per-address sign-in limit and the per-camera limit.
4. **End-to-end journeys** (`client/e2e/journeys.spec.ts`): three Playwright tests drive real
   browsers against the real stack, now part of CI.
5. **Coverage thresholds** for the client's shared code, next to the server's 80% on `services/`.

## Key concepts, simply

- **Black-box vs white-box:** the simulator only knows the public API, like a real camera or
  phone. If it can do something, a real client can too, and it can't cheat by writing rows.
- **Poisson arrivals:** cars don't come at fixed intervals. Waiting times drawn as
  `-ln(1 − u) / rate` give the natural bunching of real traffic; the rate follows the time of day.
- **Deterministic randomness:** a seeded generator (mulberry32) makes "random" choices
  repeatable: same `--seed`, same day at the gate. Tests rely on it.
- **202 Accepted:** "I've started, check back later." Used for the 90-second demo reset so the
  browser isn't left waiting and no proxy times out.
- **Self-healing client:** after a reset every key and account is new. The simulator treats a
  401 as "start over" and bootstraps again, with no human needed.
- **End-to-end test:** one test touches every layer: browser, Vite, Express, Postgres,
  Socket.io, the job scheduler and Mailpit. It catches the bugs that sit *between* units.
- **Test the real clock, but shorten it:** the overstay journey uses real minutes with limits
  made small through environment variables, instead of a fake clock inside production code.
- **Rate limiting by key:** limits are counted per IP for sign-in, per account, and per camera
  key. Counting unknown keys too means guessing camera keys is throttled.

## Files to read, in order

1. `server/prisma/seed.ts`: `emptyDatabase`, `seedSociety`, and the CLI `main` at the bottom.
2. `server/src/routes/demo.ts`: `runDemoReset` (one at a time), `POST /demo/reset` (202 / 409).
3. `server/src/jobs.ts`: the nightly reset, and how other jobs pause during one.
4. `server/src/simulator.ts`: top comment → pure helpers (`arrivalsPerMinute`, `kindFor`,
   `randomPlate`) → `runSimulator`: `bootstrap`, `arrival`, `visitor`, `guestPass`,
   `guardRounds`, and the main loop with the 401 restart.
5. `server/tests/simulator.test.ts`: the pure tests, then a real one-minute run with a reset in the middle.
6. `server/tests/system.test.ts` "rate limits": per-address and per-camera 429s.
7. `client/src/features/admin/Settings.tsx` `DemoReset`, and the reset notice in `LoginPage.tsx`.
8. `client/e2e/helpers.ts`, then `client/e2e/journeys.spec.ts`: the three journeys.
9. `.github/workflows/ci.yml` compose job: smoke test, then journeys with short limits.
10. `docker-compose.yml`: the `simulator` profile and the overridable time limits.

## Alternatives we rejected

- **Simulator writing to the database:** faster, but it would skip validation, pairing, real
  time and the jobs, so the demo would look alive without actually working.
- **Synchronous reset:** the browser would hang for 90 seconds.
- **A fake clock for e2e:** a test-only switch inside production code. Short real limits test
  the real thing.
- **A separate e2e CI job:** it would build the same images twice; the compose job already has the stack.
- **Coverage on screen components:** the journeys cover screens better than shallow render tests.

## Likely interview questions

1. **How does the demo stay alive when nobody is using it?** A simulator process plays cameras,
   guards and residents through the public API, following IST rush hours. The real jobs
   (approval timeouts, escalation ladder, emails) run on its traffic.
2. **Why doesn't the simulator write to the database directly?** Then it would test nothing and
   could create states the API never would. Through the API every read is repaired, matched and
   paired exactly like a real camera's.
3. **What happens to the simulator during a demo reset?** Its device keys and accounts stop
   working (401). It drops its queued actions, signs in again, rotates fresh keys and carries on.
   A test resets the demo under a running simulator.
4. **How do you make "random" traffic testable?** A seeded generator, pure helpers (rates,
   shares, plates) with unit tests, and a `--rate` flag so a test doesn't depend on the time of day.
5. **Why is the reset a 202?** It takes about 90 seconds. The request returns at once, a flag
   prevents a second reset (409), and the login page polls `GET /demo` until it's done.
6. **How do you test something that takes an hour (the escalation ladder) end to end?** Unit
   tests use a mocked clock. The e2e journey runs the real scheduler with the limits shortened
   to 1–2 minutes through environment variables, so it takes about 3.5 minutes.
7. **What do your end-to-end tests prove that unit tests don't?** That a camera read reaches the
   guard's screen live over Socket.io, that a resident's tap on a phone moves the car inside on
   another screen, and that the overstay email actually reaches the mail server.
8. **Which rate limits exist and why?** Sign-in per IP (20/min) and per account (10/min) against
   password guessing; camera reads per key (600/min) against a runaway camera or key guessing.
   All answer 429 with `Retry-After`.
9. **What's still missing before production?** `trust proxy` behind Caddy (or every user shares
   one IP for rate limiting), a CSP on the served app, and metrics. All are planned for Phase 8
   or listed as stretch goals.

## Exercise

Give the simulator a `--report` flag that, when it stops, prints a small table of how long
each visitor stayed versus their category's limit (from the visits it created), and the share
that overstayed. Add a unit test for the table formatting with made-up visits.
