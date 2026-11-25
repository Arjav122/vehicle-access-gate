# Phase 6: Frontend

## What we built and why

The three apps people actually use, in one React project (`client/`), plus the server pieces
they needed.

1. **Design system** (`src/index.css`, `src/components/ui/`): colour tokens for light and dark,
   one blue accent from the IND strip of a number plate, and small components on Radix. The
   signature piece is **PlateChip**, which draws every plate as a mini Indian HSRP plate.
2. **Plumbing** (`src/lib/`): a typed API client generated from the server's OpenAPI, a token
   store with automatic refresh, and one Socket.io connection that keeps every screen fresh.
3. **Landing + login** (`features/landing`, `features/auth`): the pitch, and one-click demo
   logins when the server is in demo mode.
4. **Guard console** (`features/guard`): live arrivals, visitors waiting for a decision, and a
   column of things needing attention (watchlist alerts, unclear plates, calls to make). Register
   a visitor in a few taps, redeem a guest code, decide when the resident doesn't answer.
5. **Resident app** (`features/resident`): Approve / Deny with a countdown, guest passes (code
   shown once), visit history, profile.
6. **Admin dashboard** (`features/admin`): analytics with charts and table views, visits, camera
   reads with CSV export, CRUD for flats / residents / vehicles / guards / gates / cameras /
   watchlist, nightly checks, the email log, the audit log, and settings.
7. **Server support:** `GET /analytics/overview` and `/analytics/inside` (IST), `GET /demo`, a
   seed with 14 days of history written through the real services, and `npm run openapi`.

## Key concepts, simply

- **Server state vs client state:** almost everything on screen belongs to the server (visits,
  plates, alerts). TanStack Query keeps a cache of it, with keys like `["visits", {status}]`.
  Only small UI bits (is the dialog open?) are React state.
- **Invalidate, don't patch:** after a change (yours or someone else's, via the socket), mark the
  affected queries stale and let them refetch. One source of truth, no hand-written sync code.
- **Pub/sub over WebSockets:** the server publishes `approval.decided` to a room; every browser in
  that room receives it. The guard's screen updated live when the resident tapped Approve on
  another device.
- **Single-flight refresh:** the access token lives 15 minutes. When it expires, ten requests may
  all get 401 at once. They share **one** refresh call, because refresh tokens are single-use and
  a second use looks like theft.
- **Generated types:** the server describes its API in OpenAPI; a generator turns that into
  TypeScript types. If the server renames a field, the client stops compiling (and CI fails)
  before a guard ever sees a blank screen.
- **Code splitting / lazy routes:** each area is a separate JavaScript file loaded only when
  visited. The admin charts (≈ 120 KB gzipped) never reach a resident's phone.
- **Design tokens:** colours are variables (`--accent`), not hard-coded hex values. Dark mode
  swaps the variables; components don't change.
- **Accessible by default:** Radix gives dialogs a focus trap and Esc to close. Status badges
  pair colour with a word and an icon, and charts have a "View as table" switch.
- **Open redirect:** `/login?next=//evil.example` must not send a freshly signed-in user to
  another site. We only follow `next` inside the user's own area.

## Files to read, in order

1. `client/src/index.css`: the tokens (light, dark) and how Tailwind uses them.
2. `client/src/components/ui/PlateChip.tsx` + `src/lib/plates.ts`: grouping and the plate drawing.
3. `client/src/lib/auth.ts`: token store and the single-flight `refresh()`.
4. `client/src/lib/api.ts`: the typed client, `authedFetch` (401 → refresh → retry), `unwrap`.
5. `client/src/lib/socket.ts`: one connection, `INVALIDATES`, refetch after reconnect.
6. `client/src/app/providers.tsx` and `src/app/state.ts`: query client, theme, real-time provider.
7. `client/src/app/App.tsx` and `layouts.tsx`: routes, `RequireRole`, the three shells.
8. `client/src/features/auth/session.ts` + `LoginPage.tsx`: `useMe`, sign-in writes the user in place.
9. `client/src/features/guard/` (`GuardConsole` → `Arrivals` → `Waiting` → `Attention` → `RegisterVisitorDialog`; data in `queries.ts`).
10. `client/src/features/resident/Approvals.tsx`: the countdown and the two big buttons.
11. `client/src/features/admin/Overview.tsx`, then `Resources.tsx` (one generic table, many configs).
12. `server/src/services/analytics.ts`: the SQL behind the dashboard (IST buckets).
13. `server/prisma/seed.ts` `seedHistory`: how 14 days of history are replayed through the services.
14. Tests: `client/src/**/*.test.ts(x)` (42 tests) and `server/tests/analytics.test.ts`.

## Alternatives we rejected

- **Next.js** (v1): server rendering adds little to screens behind a sign-in.
- **Redux / Zustand for server data:** a second copy of the truth that every event would need to update.
- **Patching the cache from socket payloads:** faster by a few milliseconds, but two code paths that can disagree.
- **A component kit like Material UI:** heavy, and its look fights the product's.
- **Six hand-written admin CRUD pages:** one config-driven table is less code and behaves the same everywhere.
- **A dual-axis chart** for resident entries and visits: two charts read correctly; two y-axes mislead.

## Likely interview questions

1. **How does the guard's screen update when a resident approves on their phone?** The server
   commits, then publishes `approval.decided` to the `staff` room. The guard's socket receives
   it and invalidates `visits`, `approvals` and `inside`; those queries refetch.
2. **What if the guard's Wi-Fi drops for a minute?** Socket.io reconnects with backoff. On
   reconnect the client refetches everything, because events sent while offline are gone. A slow
   timer refetch is a safety net too.
3. **How do you stop a guard registering the same car twice?** The server refuses (409) a second
   registration for the same read. The client also invalidates arrivals right after a successful
   registration, so the Register button disappears immediately.
4. **Why do 10 parallel 401s cause only one refresh?** `refresh()` stores its promise; callers
   reuse it until it settles. A test proves one call. Reusing a single-use token would revoke
   all sessions.
5. **Where are tokens stored, and what's the risk?** In memory, mirrored to localStorage so a
   reload keeps you signed in. XSS could read them, so React's escaping and (Phase 8) a CSP
   matter. An httpOnly refresh cookie is the alternative we may switch to.
6. **How do you keep the client and the API in sync?** Types are generated from the server's
   OpenAPI; CI regenerates both files and fails on any difference.
7. **How did you make it accessible?** Radix primitives (focus traps, keyboard), labels wired to
   inputs, visible focus rings, status = colour + word + icon, PlateChip read out character by
   character, charts with a table view, and AA contrast in both themes.
8. **Why is the guard console dark by default?** Night shifts and glare at the gate; less glare
   at night. Guards can switch, and the choice is remembered separately from the other areas.
9. **What does "busiest hours" mean exactly, and in which time zone?** Entry-lane reads per hour
   of the day in IST, summed over the chosen period, computed in SQL with
   `AT TIME ZONE 'Asia/Kolkata'`.
10. **How is the demo seeded without breaking the jobs?** History is replayed through the same
    services the API uses, so pairing, approvals and history rows are real. The jobs find only
    the deliberate "right now" state to work on.

## Exercise

Add a "Frequent visitors" click-through: in `features/admin/Overview.tsx`, make each plate in
the frequent-visitors table a link to `/admin/visits?q=<plate>`. Then make `Visits.tsx` read `q`
from the URL as its initial search (and keep it in the URL as you type). Add a Testing Library
test that renders `Visits` at `/admin/visits?q=UP16AB1234` and checks the request sent
`q=UP16AB1234`.
