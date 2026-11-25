# Phase 2: Gate event engine

## What we built and why

The part of the server that turns "a camera saw something" into "Priya's car came in" or "unknown car, ask the guard".

1. **Plate repair** (`services/plates.ts`): OCR reads `KAO5MNOO42`, and we work out it is `KA05MN0042`.
2. **Fuzzy matching:** a read one character off still finds the right car. If two cars are equally close, we don't guess; a guard decides.
3. **Visit state machine** (`services/visitState.ts`): a table of which moves are legal, and a single function, `transitionVisit`, that is allowed to change a visit's status.
4. **Gate event ingest** (`services/gateEvents.ts`): one camera read → retry check → same-car check → matching → side effects (alert, entry/exit pairing, visit moves in/out). All in one transaction.
5. **Review queue and corrections:** unclear reads wait for a guard. A guard's correction is saved as labelled data for retraining the camera model later.
6. **Alerts:** a watchlist hit becomes a critical alert, even when the read was blurry.
7. **Snapshots:** the camera's photo of each car, stored in a local folder and checked by its first bytes.

## Key concepts, simply

- **Look-alike characters:** OCR mixes up O/0, I/1, B/8, S/5, Z/2, G/6, T/7 and A/4. We know where letters and digits must be (state = letters, district = digits, …), so a letter in a digit position is swapped for its look-alike. Each swap costs 1 point, and the cheapest valid reading wins.
- **Levenshtein distance:** how many single-character edits turn one string into another. `UP16AB1234` → `UP16AB1284` is 1.
- **Idempotency:** doing the same thing twice has the same effect as once. A camera that retries an upload gets back the first result, not a second event.
- **Debouncing:** a car waiting at the barrier is read 20 times in a few seconds. We fold reads of the same plate on the same camera within 30 s into one event.
- **Advisory lock:** a named lock in Postgres. Two requests for the same (camera, plate) take turns, so they can't both create an event.
- **State machine:** a fixed list of states and the moves allowed between them. Anything not in the table is refused (409) and nothing changes.
- **Magic bytes:** the first bytes of a file say what it really is (JPEG starts `FF D8 FF`). The file name and the Content-Type header can lie; these bytes can't.
- **CSV injection:** a spreadsheet runs a cell that starts with `=`. We prefix such cells with `'` in exports.

## Files to read, in order

1. `server/src/services/plates.ts`: cleaning, validation, `repairPlate`, `levenshtein`, `bestMatch`.
2. `server/tests/plates.test.ts`: the cases tell the story better than prose.
3. `server/src/services/visitState.ts` and `tests/visitState.test.ts`: the 10 legal moves and all 56 pairs.
4. `server/src/services/visits.ts`: `createVisit` and `transitionVisit` (row lock, timers, history row).
5. `server/src/services/gateEvents.ts`: `ingestRead`, `decide`, `applyDecision`, `reviewEvent`.
6. `server/src/routes/gateEvents.ts`: the camera upload, list/CSV, review queue, snapshot, review.
7. `server/src/services/storage.ts`: snapshot keys and magic bytes.
8. `server/tests/gateEvents.test.ts`: scripted camera sequences end to end.

## Alternatives we rejected

- **Repair on the camera:** the camera and the server would disagree about plates. Repair lives in one place, on the server.
- **Debounce with arrival time:** replayed offline reads would merge with live ones. We use the camera's capture time.
- **Redis locks for debounce:** an extra service. Postgres advisory locks do it inside the same transaction.
- **Guessing between two close plates:** a wrong guess logs the wrong flat's car. A guard is faster than an investigation.
- **S3 storage now:** untested code. It comes with deployment (decision D15).

## Likely interview questions

1. **How do you turn `KAO5MNOO42` into `KA05MN0042`?** Try every legal layout for that length. Swap letters in digit positions for their look-alike digits (and vice versa), at 1 point each. Add small penalties for unusual shapes, and keep the cheapest. More than 3 swaps → unreadable.
2. **What stops one waiting car from creating 20 events?** A 30-second sliding window per (camera, plate), measured with the camera's capture time, inside an advisory-locked transaction.
3. **What if the camera retries an upload?** The event hash (device + plate + capture time) is already stored, so we return the existing event with status `duplicate`. A unique index backs this up.
4. **Why check the watchlist before confidence?** A blurry read of a stolen car must still warn the guard. Missing it costs more than a false alarm.
5. **Why is `transitionVisit` the only function that changes a visit's status?** Every rule (legal moves, timers, history rows, closing escalation tasks) is enforced in one place, so nothing can skip it.
6. **How do you pair a resident's exit with their entry?** Lock the vehicle's latest entry that no exit has claimed yet (`FOR UPDATE`), and store the link. A unique index means an entry can be closed only once.
7. **How do you keep fuzzy matching fast as the society grows?** The database pre-filters by plate length (±1), and only `(plate, id)` pairs come back. The comparison stops early once the distance exceeds 1.
8. **How do you avoid dropping a car when something goes wrong?** If the visit changed in the meantime, the read is kept and sent to review. A snapshot is deleted only when the read was a retry or the same car.
9. **How is a file upload checked?** Size limit (413), only one file, and magic bytes must say JPEG, PNG or WebP (422).
10. **What would change with several server instances?** Nothing in the logic. The advisory locks and unique indexes already work across instances, because they live in Postgres.

## Exercise

Add the swap `Q → 0` (OCR sometimes reads 0 as Q) to `TO_DIGIT` in `plates.ts`. Write two table cases first: `UP16ABQ234` → `UP16AB0234`, and a plate whose series contains Q, which must still be refused. Then run `npm test`. Does any existing case change? Why?
