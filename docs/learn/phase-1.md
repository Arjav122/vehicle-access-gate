# Phase 1: Server core, database, auth

## What we built and why

The API's backbone. Every later feature (gate events, visits, approvals) sits on it.

1. **Configuration** (`config.ts`): every setting is read from environment variables once and checked with Zod. A typo or a missing value stops the server at startup with a clear message, instead of failing at 3 a.m. In production the server also refuses to start with the default JWT secret.
2. **Database** (Prisma + PostgreSQL): all 21 tables of the brief exist from day one, so later phases only add code, not schema churn. Rules that matter live in the database itself: unique keys, foreign keys, and CHECK constraints such as "a guest pass can't be used more times than allowed".
3. **Auth**: sign-in with email and password (argon2id), short-lived access tokens, single-use refresh tokens with theft detection, roles (admin, guard, resident), and a separate key for cameras.
4. **Admin resources**: flats, residents, guards, vehicles, gates, camera devices and the watchlist, each with list/search/pagination, create, update and delete, and an audit log of every change.
5. **API docs**: generated from the same Zod schemas that validate input, served at `/api/docs`.
6. **Seed data**: a made-up society with 40 flats, 60 residents and 81 vehicles with real-looking plates.
7. **Tests**: 265 tests against a real Postgres, including every role on every route.

## Key concepts, simply

- **JWT (JSON Web Token):** a small signed note: "this is user 42, valid until 10:15". The server can check the signature without a database lookup. We still look the user up on every request, so deactivating someone takes effect immediately.
- **Access vs refresh token:** the access token is short-lived (15 min), so a stolen one is useful only briefly. The refresh token (7 days) is used only to get a new pair.
- **Refresh token rotation and reuse detection:** each refresh token works once. If a used one shows up again, someone copied it, so we sign that user out everywhere.
- **argon2id:** a password-hashing function that is slow and memory-hungry on purpose, so guessing passwords from a stolen database is very expensive.
- **Timing attack and the dummy hash:** if "unknown email" answered faster than "wrong password", an attacker could learn which emails exist. So we always run one hash check, against a dummy hash when the email is unknown.
- **RBAC (role-based access control):** each endpoint lists the roles allowed to call it. 401 means "who are you?" (no or invalid token); 403 means "I know who you are, but you may not do this".
- **Rate limiting:** after 10 failed logins a minute for one account (or 20 from one IP), the server answers 429 with `Retry-After`. This slows password guessing.
- **Migration:** a versioned SQL file that changes the schema. Every database (laptop, CI, Supabase) reaches the same shape by running the same files in order.
- **CHECK constraint / partial index:** a CHECK is a rule the database enforces on every row (`use_count <= max_uses`). A partial index covers only some rows, e.g. "unique flat_id among primary contacts" means one primary contact per flat.
- **Transaction:** several writes that succeed or fail together. A change and its audit-log row are written in one transaction, so there's never a change without its audit entry.
- **OpenAPI:** a machine-readable description of the API. Swagger UI turns it into a page where you can try every endpoint.

## Files to read, in order

1. `server/prisma/schema.prisma`: every table, enum and relation.
2. `server/prisma/migrations/*_init/migration.sql`, the last section: the hand-written CHECKs and partial indexes.
3. `server/src/config.ts`: environment parsing and the production secret rule.
4. `server/src/db.ts`: the Prisma client, `withTx`, and how a constraint error becomes a 409.
5. `server/src/services/auth.ts`: passwords, tokens, rotation and reuse detection.
6. `server/src/middleware.ts`: request ids, logging, headers, CORS, rate limits, `requireRoles`, `requireDevice`, errors.
7. `server/src/openapi.ts`: `defineRoute`, one declaration giving validation, access control and docs.
8. `server/src/routes/vehicles.ts`: a typical resource (plate cleaning, audit, 404/409).
9. `server/src/routes/devices.ts`: camera keys shown once, stored as hashes, rotation.
10. `server/src/services/audit.ts` and `services/plates.ts`: small pure functions.
11. `server/prisma/seed.ts`: the demo society, with deterministic randomness.
12. `server/tests/rbac.test.ts`: how one test covers every role on every route.

## Alternatives we rejected

- **Sessions in the database instead of JWT:** simpler to revoke, but the brief asks for JWT. We get the revocation benefit anyway by loading the user on every request.
- **bcrypt:** fine, but argon2id is the current recommendation (memory-hard).
- **Supabase Auth:** quick, but it hides the auth design we want to be able to explain, and ties us to one vendor.
- **Redis:** not needed for one server (see decisions D12 for when it would be).
- **NestJS / tRPC:** more structure, but more magic. Express + Zod + one helper is easy to read top to bottom.
- **A fake in-memory database for tests:** wouldn't test CHECK constraints, unique indexes or row locks.

## Likely interview questions

1. **Why short access tokens plus refresh tokens instead of one long token?** A stolen access token works for only 15 minutes. Refresh tokens are single-use and checked against the database, so they can be revoked.
2. **How do you detect a stolen refresh token?** Each refresh token works once. If a used one comes back, two parties hold it, so we revoke all of that user's sessions.
3. **Why load the user from the database on every request if JWTs are self-contained?** So deactivation and role changes take effect immediately. It's one indexed lookup by primary key, which is cheap.
4. **How do you stop people from learning which emails are registered?** The same error message for every failure, and the same work (a hash check) even for unknown emails, so the timing matches.
5. **How do you make sure no endpoint forgets its role check?** Every endpoint is declared with its roles via `defineRoute`, and a test walks the route table and tries every role on every route.
6. **Why store device keys as SHA-256 but passwords as argon2id?** Device keys are 32 random bytes and can't be guessed, so a fast hash is enough. Passwords are human-chosen and guessable, so they need a slow hash.
7. **What happens if two admins add the same plate at the same moment?** The unique index on `plate_normalized` rejects the second insert, and the API turns that into a 409 with a clear message.
8. **Why keep business rules in the database (CHECKs) as well as in code?** The database is the last line of defence. A bug, a script or a manual fix still can't create impossible data.
9. **How do the tests stay isolated with a real database?** Each test truncates every table first, and test files run one at a time against a dedicated `_test` database.
10. **Why is Redis not used?** One server instance. Postgres covers locking, queues and idempotency. We'd add Redis when scaling out (Socket.io adapter, shared rate limits, BullMQ).

## Exercise

Add a `GET /api/flats/:id/vehicles` endpoint for admins and guards that lists a flat's vehicles with pagination. Declare it with `defineRoute` and run `npm test`. The RBAC test will cover it automatically. Then write one test that checks that a guard gets 200, a resident gets 403, and an unknown flat id gets 404.
