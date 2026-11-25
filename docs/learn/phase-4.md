# Phase 4: Visitors, approvals, guest passes, real time

## What we built and why

The human side of the gate: an unknown car arrives, the guard registers the visitor, the resident approves on their phone, and everyone's screen updates at once.

1. **Visitor registration** (`POST /visits`): the guard enters the visitor's details, flat and category (guest / delivery / cab / service), and can link the waiting car's camera read.
2. **Approvals** (`services/approvals.ts`): the flat's residents have 3 minutes to approve or deny. The first answer wins. After the timeout the guard decides.
3. **Guest passes** (`services/guestPasses.ts`): residents let guests in ahead of time, by plate (the camera opens the gate on its own) or by a one-time code the guard types.
4. **Settings** (`/settings`): admins set the time limits and the approval timeout; every change is audited.
5. **Real time** (`realtime.ts`): Socket.io pushes events to staff and to the right residents the moment something changes.
6. **A scheduled job** (`jobs.ts`): every 15 seconds, overdue approvals are handed to the guard.

## Key concepts, simply

- **Row lock (`SELECT … FOR UPDATE`):** "I'm working on this row; anyone else waits." Two residents tapping at the same instant are handled one after the other, so the second sees the first's answer.
- **Idempotent answer:** sending the same answer twice does nothing new (200). Sending a different answer is a conflict (409). That makes network retries safe.
- **Timeout checked twice:** the job expires approvals every 15 s, and every answer also checks the clock itself. So a tap at 3:05 is refused even if the job hasn't run yet.
- **Conditional update:** `UPDATE … SET use_count = use_count + 1 WHERE use_count < max_uses`. The database does the check and the change in one step, so a 1-use pass can't be used twice, however fast two cars arrive.
- **HMAC:** a keyed hash. Storing the code's HMAC means even someone with a copy of the database can't read the codes back.
- **Pub/sub and rooms:** the server *publishes* an event to a *room* (e.g. "staff", or "user:42"); everyone *subscribed* to that room receives it.
- **Publish after commit:** send the event only once the database change is saved. Otherwise a screen could show a change that was then rolled back.
- **Events are hints:** the browser treats an event as "this list changed, fetch it again". Nothing is lost if an event is missed: the screen refetches on reconnect.

## Files to read, in order

1. `server/src/services/approvals.ts`: `residentDecides`, `guardDecides`, `expireApprovals`.
2. `server/src/services/visits.ts`: `registerVisit`, `admitWaitingCar`, `effectiveSettings`.
3. `server/src/routes/visits.ts`: registration, lists (phones masked), guard decision, manual entry/exit.
4. `server/src/routes/approvals.ts`: what a resident calls.
5. `server/src/services/guestPasses.ts` and `routes/guestPasses.ts`: codes, HMAC, `consumeUse`, `admitWithPass`.
6. `server/src/services/gateEvents.ts` `decide()`: how a guest-pass plate is matched at the entry gate.
7. `server/src/realtime.ts` and `server/src/jobs.ts`: rooms, publishing, the 15-second job.
8. `server/tests/visitors.test.ts`: the whole story as a test, including real Socket.io clients.

## Alternatives we rejected

- **Letting the guard decide at any time:** residents would be overruled before they could answer. The guard decides only after the timeout.
- **Plain-text codes in the database:** a leaked database would leak every active code.
- **Polling every few seconds for new approvals:** slow and wasteful. Push events are instant and cheap.
- **Server-sent events:** fine for one-way updates, but Socket.io gives rooms, reconnection and auth in one well-known package.
- **Sending real time from inside the transaction:** a rollback would leave screens showing something that never happened.

## Likely interview questions

1. **Two residents tap Approve and Deny at the same moment. What happens?** Both requests lock the same approval row; one waits. The first sets the status, and the second sees it's already decided differently and gets 409. Exactly one decision and one history row; there's a test for it.
2. **How does the 3-minute timeout work if the server restarts?** The deadline is stored (`expires_at`). The job picks up anything overdue on its next run, and late answers check the clock themselves. Nothing lives only in memory.
3. **How can a guest pass not be used twice by two cars at once?** A conditional `UPDATE` with `use_count < max_uses` in the `WHERE`. Only one of the two updates matches the row; the CHECK constraint is a backstop.
4. **Why hash guest-pass codes?** Same reason as passwords: a database leak must not let someone walk in. HMAC with a server key, because codes are short.
5. **How do you stop one flat seeing another flat's visitors in real time?** Visit events go to the `staff` room plus the `user:<id>` rooms of that flat's active residents only. A test checks that the neighbour receives nothing.
6. **Why publish events after the commit?** So nobody sees a change that was rolled back. If publishing fails, the change is still saved; screens catch up on refetch.
7. **What stops a guard registering the same car twice?** The car's gate event is locked and can be linked to only one visit; a second registration gets 409.
8. **Why mask phone numbers?** Privacy: lists are seen by many people. The full number appears only in a single visit's details, for staff and the host flat.

## Exercise

Add `POST /visits/:id/cancel` for the guard: it moves a `pending_approval` visit to `expired` (the visitor left before anyone answered) and marks its approval `timed_out`. Use `transitionVisit` (with the `expire` trigger), publish `visit.updated` after the commit, and write a test where the resident's later answer is refused.
