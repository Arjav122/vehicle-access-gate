# Interview guide

How to talk about this project: a 2-minute pitch, a walkthrough of the architecture, the ten
hardest questions with answers, and what I'd do differently. The per-phase study guides in this
folder go deeper.

## The 2-minute pitch

> In Indian housing societies the gate is a bottleneck: guards write car numbers in a register,
> call flats on the intercom for every delivery, and nobody notices a cab that never left. I
> built a system that fixes that end to end.
>
> At the gate, a Python worker runs a YOLO11 plate detector through ONNX Runtime, reads the text
> with PaddleOCR, and votes across video frames so one car produces exactly one read. It works
> offline: reads queue in SQLite and replay in order.
>
> The Node/TypeScript API decides what a read means. It repairs OCR mistakes by position (O↔0,
> B↔8, the HSRP "IND" mark), validates real Indian formats, and fuzzy-matches against residents,
> guest passes and a watchlist. Resident cars are logged automatically. For an unknown car the
> guard registers the visitor and the flat's residents get Approve / Deny on their phones in
> real time; if nobody answers in 3 minutes, the guard decides. Every visit goes through a
> tested state machine, and visitors who overstay trigger emails and then a "call the resident"
> task.
>
> The React app has three faces: a dark, touch-friendly guard console, a mobile-first resident
> app, and an admin dashboard with analytics.
>
> It is tested at every level: about 600 server tests against a real Postgres, unit tests for the
> client and the worker, and three Playwright journeys against the real stack in CI. A traffic
> simulator keeps the demo alive through the public API.

## Architecture walkthrough (follow one car)

1. **Camera → worker** (`anpr/`): frames are sampled at 5 fps. The detector finds the plate (ONNX,
   letterbox, NumPy decode + NMS). OCR reads the crop. The tracker groups reads within 2 edits and
   sends once: after 3 agreeing reads or a 2-second gap. The client posts with a device key; if the
   server is down, the SQLite buffer keeps it.
2. **API ingest** (`server/src/services/gateEvents.ts`): inside one transaction holding an advisory
   lock on (camera, plate):
   - a hash detects exact retries (`duplicate`);
   - a 30-second window by *camera time* folds repeated sightings (`debounced`);
   - the plate is repaired and matched, watchlist first.
3. **Decision:**
   - a resident car is logged and paired with its entry (`FOR UPDATE`);
   - an expected visitor or a guest pass moves the visit to INSIDE through `transitionVisit()`, the
     only writer of a visit's status;
   - an unknown car waits for the guard.
4. **Real time** (`realtime.ts`): after commit, events go to rooms (`staff`, `user:<id>`). Browsers
   don't patch data; they invalidate TanStack queries and refetch.
5. **Approvals** (`approvals.ts`): the resident's tap locks the row, first answer wins. A 15-second
   job hands overdue approvals to the guard.
6. **Afterwards** (`jobs.ts`):
   - the escalation ladder runs every minute from a passed-in clock;
   - emails go through an outbox and a `SKIP LOCKED` dispatcher with backoff;
   - nightly reconciliation and retention clean up.

## The 10 hardest questions

1. **How do you stop one car creating ten events?**
   Two layers. Idempotency: `sha256(device | repaired plate | capturedAt)` is unique, so a network
   retry returns the existing row. Debounce: under `pg_advisory_xact_lock(hash(device, plate))`, a
   read within 30 s of the last sighting just pushes `lastSeenAt` forward. I compare *camera*
   timestamps, so reads replayed hours later from the offline buffer stay separate events.

2. **Why fix plates on the server, not on the camera?**
   One place for the rules, so the camera, the guard's manual correction and the simulator can
   never disagree. The worker only drops an "IND" piece. Repair is a pure function with 84
   table-driven tests: it tries every legal layout, swaps a look-alike only where the layout needs
   the other kind of character, scores the result, and refuses more than 3 fixes.

3. **What happens if two residents of a flat tap Approve and Deny at the same moment?**
   Both requests lock the same approvals row `FOR UPDATE`, so they run one after the other. The
   first wins; the second sees a decided row. The same answer again gets 200, a different answer
   gets 409. There's a test that fires both in parallel.

4. **The server was down for two hours. What does the escalation job do?**
   The ladder computes *every* step that is due from the clock it is given, and records each at the
   time it was due. Each step is idempotent: the state machine refuses a second overstay, emails have
   unique keys, and there is one task per visit. So one run after the outage does each step exactly
   once, in order. Tested with a mocked clock, including two runs racing.

5. **Why no Redis or message queue?**
   One server instance is enough for one society. Postgres already gives locks, uniqueness and
   `SKIP LOCKED` for the job queue. The decisions log says what changes to scale out: the Socket.io
   Redis adapter, BullMQ for jobs, and a Redis debounce.

6. **How is real time kept consistent?**
   Events are published only after the transaction commits, so nobody hears about a change that
   rolled back. Clients treat events as "something changed": they invalidate queries and refetch,
   so there's one source of truth. After a reconnect they refetch everything, because events sent
   while offline are lost.

7. **How do you test something that takes an hour?**
   The rules are pure functions of a clock passed in, and unit tests pass any `now`. The end-to-end
   overstay journey runs the real scheduler with the limits shortened to 1–2 minutes through
   environment variables, so there is no test-only code path in production.

8. **Your detector is AGPL. Isn't that a problem for an MIT project?**
   The weights aren't distributed here: the worker downloads them from their publisher at a pinned
   commit and checks the SHA-256. The code stays MIT, and the README says plainly what the model's
   licence is. A self-trained model would be published as `models-v1`.

9. **Why ONNX Runtime and a hand-written NMS instead of Ultralytics?**
   It keeps PyTorch and AGPL code off the edge device, gives a much smaller install, and loads the
   model once. Decode + NMS is about 80 lines of NumPy with tests on hand-built tensors. Detector
   speed measured on my laptop: 49 ms median per 1280×720 frame on CPU.

10. **What would break first in production?**
    Rate limiting behind a reverse proxy: without `trust proxy` every user looks like one IP, which
    is planned with Caddy. Then plate accuracy in bad light: I haven't measured accuracy yet
    because that needs labelled photos, so the README says TBD rather than guessing.

## What I'd do differently

- **Collect labelled photos on day one.** I built the evaluation script but have no accuracy
  numbers. A small labelled set early would have guided the OCR and repair work with data.
- **Train my own detector** instead of depending on a third-party AGPL model.
- **Decide the auth storage up front:** I'd consider an httpOnly refresh cookie with CSRF
  protection from the start rather than leaving it as an alternative.
- **Write the end-to-end journeys earlier:** they caught issues no unit test could, and they make
  refactoring the UI safe.
- **Keep the seed's time logic pure from the start:** a "right now" visitor was once registered
  a few seconds in the future, so the approval showed 3:18 instead of at most 3:00. It's fixed
  with a regression test, but a pure helper from day one would have avoided it.
