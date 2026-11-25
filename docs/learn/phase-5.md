# Phase 5: Escalation, notifications, scheduled jobs

## What we built and why

The follow-up side of the gate: what happens *after* a car is inside, and the housekeeping that runs at night.

1. **Email outbox** (`services/notifications.ts`): emails are written to a `notifications` table first and sent later by a job, with retries.
2. **Escalation ladder** (`services/escalation.ts`): a visitor past the time limit triggers an email to the visitor and the residents at the limit, a reminder 30 minutes later, and a "call the resident" task for the guard at 60 minutes.
3. **Escalation tasks API** (`routes/escalations.ts`): the guard sees who to call (full phone number), then records "reached" or "not reached". When the car leaves, the task closes itself.
4. **Reconciliation** (`services/reconciliation.ts`): every night, records that don't add up are flagged for an admin (an exit with no entry, an entry never closed, a visit stuck inside).
5. **Retention** (`services/retention.ts`): every night, visitor names, phones and emails older than 90 days are erased, old emails are redacted and old snapshots are deleted.
6. **The schedule** (`jobs.ts`): five jobs on node-cron, India time, enabled with `RUN_JOBS=true`.

## Key concepts, simply

- **Outbox pattern:** instead of sending an email in the middle of a request, write "please send this" into a table in the *same transaction* as the change. If the change rolls back, the email disappears too. A separate worker sends what's in the table.
- **Idempotency key:** a unique name for one email, like `visit:42:overstay_reminder:resident:7`. Inserting it twice does nothing (`ON CONFLICT DO NOTHING`), so a job can run as often as it likes.
- **`FOR UPDATE SKIP LOCKED`:** "give me a row nobody else is working on." Two dispatchers can run at once and never pick the same email.
- **Exponential backoff:** wait 1, 2, 4, 8 … minutes between retries (capped at 60). A broken mail server is not hammered, and a short outage heals itself.
- **Pure function + injected clock:** `dueSteps(visit, now)` only looks at its inputs. Tests pass any `now` they like ("pretend it's 95 minutes later") instead of waiting.
- **Catch-up after an outage:** the ladder works out *every* step that is due, not just the next one, and records each one at the time it was due. Three hours of downtime → one run does all three steps, in order.
- **At-least-once delivery:** if the server dies after the mail server accepts an email but before we mark it sent, it can be sent again. That's the honest guarantee for email; everything else is exactly once.
- **Anonymise, don't delete:** a visit row stays (for analytics), but the visitor's personal fields are set to NULL.

## Files to read, in order

1. `server/src/services/notifications.ts`: templates, `queueEmail`, `dispatchDue`, `backoffMinutes`.
2. `server/src/services/escalation.ts`: `dueSteps` (pure), then `runLadder` and how each step is applied.
3. `server/src/services/visits.ts` `transitionVisit`: how `exit` resolves an open escalation task.
4. `server/src/routes/escalations.ts`: the guard's task list and the resolve endpoint.
5. `server/src/services/reconciliation.ts`: three `INSERT … SELECT` statements.
6. `server/src/services/retention.ts`: what gets erased and when.
7. `server/src/routes/reconciliation.ts`: admin lists for findings and the email delivery log.
8. `server/src/jobs.ts`: the schedule, and `guarded()` so one failing job never crashes the server.
9. `server/tests/jobs.test.ts`: the whole ladder with a mocked clock.

## Alternatives we rejected

- **Sending email inside the request:** slow for the user, and a rollback can't unsend it.
- **A Redis/BullMQ queue:** another service to run for a handful of emails a minute; Postgres already gives us locking and uniqueness.
- **A timer per visit (`setTimeout`):** lost on every restart.
- **Deleting old visitors:** would break visit history and analytics. Erasing the personal fields is enough.
- **Auto-fixing reconciliation findings:** a wrong guess could hide a real problem (a broken camera, say), so an admin decides.

## Likely interview questions

1. **How do you make sure an overstay email is sent only once, even if the job runs twice?** Each email has a unique idempotency key and is inserted with `ON CONFLICT DO NOTHING`. The visit's status change is refused by the state machine the second time. A test runs the ladder repeatedly and races two runs.
2. **What if the mail server is down?** The row stays `pending` with the error. The dispatcher retries after 1, 2, 4, 8 minutes, and after 5 failed attempts marks it `failed`, visible in the admin delivery log.
3. **Two server processes both run the dispatcher. Can a resident get two copies?** No: each claims rows with `FOR UPDATE SKIP LOCKED`, so a row being sent by one is invisible to the other. There's a test with two dispatchers in parallel.
4. **How do you test something that happens 60 minutes later?** The clock is a parameter. Tests call `runLadder(at(61))` instead of waiting.
5. **The server was down for 2 hours. What happens to a visitor who overstayed during that time?** The next tick does every due step at once, in order (overstay, reminder, escalate), and the history records the times they were due, not the time the job ran.
6. **Why is the guard shown the full phone number here when lists mask it?** The guard's job at that point is to dial the resident. Masking applies to lists that many people see.
7. **What does reconciliation catch?** Missed camera reads: an exit with no matching entry, an entry that was never closed but the car came in again later, and visits that have been "inside" for over a day past their limit.
8. **How do you handle the 90-day privacy rule?** A nightly job erases the visitor's name, phone and email (unless they are still inside), redacts old emails and deletes old snapshots. Visit counts and durations stay for analytics.
9. **Why node-cron inside the API process instead of a separate worker?** One small server is enough. Because every job is idempotent in the database, a restart or overlap is harmless. With several instances we'd move jobs to one worker or use a lock.

## Exercise

Add a fourth ladder step, `final_notice`, at +90 minutes: email the society admin (every active admin user) once per visit, with key `visit:<id>:final_notice:admin:<userId>`. Add it to `dueSteps`, write the template, and extend the mocked-clock test so that running the ladder at +91 and +120 minutes queues exactly one email per admin.
