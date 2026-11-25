# Database

PostgreSQL through Prisma. The schema is in [`server/prisma/schema.prisma`](../server/prisma/schema.prisma). Migrations are in `server/prisma/migrations/`. The first migration ends with hand-written SQL for the rules Prisma cannot express: CHECK constraints and partial indexes.

**Conventions:** UUID ids, `timestamptz` in UTC, snake_case names, and Prisma enums with lower-case values. Plates are stored twice: `plate_raw` holds the text as it was read or typed, and `plate_normalized` holds the cleaned form, e.g. `UP16AB1234`. People are deactivated (`is_active = false`), never deleted. The schema changes only through migrations.

## Entity–relationship diagram

```mermaid
erDiagram
  flats ||--o{ residents : "has"
  users ||--o{ residents : "is"
  users ||--o{ refresh_tokens : "signs in with"
  flats ||--o{ vehicles : "owns"
  gates ||--o{ devices : "has lanes"
  devices ||--o{ gate_events : "reads"
  gates ||--o{ gate_events : "at"
  vehicles |o--o{ gate_events : "matched to"
  gate_events |o--o| gate_events : "exit pairs entry"
  gate_events ||--o{ plate_corrections : "fixed by guard"
  gate_events ||--o{ alerts : "raises"
  flats ||--o{ visits : "visited"
  visitors |o--o{ visits : "makes"
  guest_passes |o--o{ visits : "admits"
  flats ||--o{ guest_passes : "issues"
  visits ||--o{ visit_status_changes : "history"
  visits ||--o| approvals : "needs"
  visits ||--o| escalation_tasks : "follow-up"
  gate_events |o--o| visits : "entry / exit"
  visits |o--o{ reconciliation_flags : "flagged"
  gate_events |o--o{ reconciliation_flags : "flagged"
  users |o--o{ audit_logs : "changed"
```

## Tables

| Table | One line |
|---|---|
| `society_settings` | One row (`id = 1`, CHECK) of admin-tunable limits; when there is no row, the config defaults apply. |
| `flats` | A home, shown as `B-402`; `(block, number)` is unique. |
| `users` | Everyone who signs in (admin, guard, resident). The email is stored lower-case (CHECK); the password is an argon2id hash. |
| `residents` | Links a resident user to a flat. At most one primary contact per flat (partial unique index). |
| `refresh_tokens` | One row per refresh token (by `jti`). Revoked when used, so each token works only once. |
| `vehicles` | A resident vehicle belonging to a flat. `plate_normalized` is unique and has the shape of a cleaned plate (CHECK). |
| `watchlist` | Plates that raise a high-priority alert at the gate. |
| `gates` | A physical gate, e.g. "Main gate". |
| `devices` | One camera per lane (entry or exit). Only the SHA-256 of its key and a short prefix are stored. |
| `gate_events` | One car read by one camera: plate, confidence (0–1, CHECK), match result, and the debounce timestamp `last_seen_at`. `event_hash` is unique (idempotency). Partial index on the open review queue. |
| `plate_corrections` | A guard's fix of an unclear read: labelled data for retraining. |
| `alerts` | A watchlist hit, until a guard acknowledges it. |
| `visitors` | A visitor's name, phone and email; nulled out after the retention period. |
| `visits` | One visit to a flat, moving through the state machine (`pending_approval` → … → `exited`). |
| `visit_status_changes` | Append-only history of every status change, written in the same transaction as the change. |
| `approvals` | The resident's approve/deny request for a visit (one per visit), with its expiry. |
| `guest_passes` | A pass by plate or one-time code (stored as an HMAC), with a validity window and use limit. Several CHECKs, e.g. `use_count <= max_uses`. |
| `escalation_tasks` | A "call the resident" task for the guard (one per visit). An outcome is set exactly when the task is resolved (CHECK). |
| `notifications` | Outbox of emails and Telegram messages with retries. `idempotency_key` is unique, so the same message is never queued twice. |
| `reconciliation_flags` | Nightly findings (an exit without an entry, …), unique per `(kind, subject)`. |
| `audit_logs` | Who changed what (`{ field: [before, after] }`). Never holds passwords or key hashes. |

## Delete rules

- Guards and residents are deactivated, never deleted.
- Flats, gates and devices can be deleted only while nothing refers to them. Otherwise the foreign key (`ON DELETE RESTRICT`) blocks it and the API answers 409.
- Vehicles and watchlist entries can be deleted. Past gate events keep the plate text, and their `vehicle_id` becomes NULL.

## Working with the database

```powershell
docker compose up -d postgres
```

```powershell
cd server; $env:DIRECT_URL="postgresql://vehicle_access:vehicle_access@127.0.0.1:5432/vehicle_access"; npx prisma migrate dev --name describe_the_change
```

The server's Docker container applies new migrations on start (`prisma migrate deploy`). Seed demo data with:

```powershell
docker compose exec server npm run seed -- --reset
```
