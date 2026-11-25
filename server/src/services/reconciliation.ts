// Nightly reconciliation (brief §10.6): find records that don't add up, for an admin to check.
//   exit_without_entry  – a resident's exit read with no open entry to pair with
//   entry_never_closed  – a resident's entry that a LATER entry superseded with no exit in
//                         between (a missed exit). One open entry is normal: the car is parked.
//   stale_visit         – a visit still inside a day past its time limit
// Each finding is stored once per (kind, subject) thanks to a unique index, so re-running the
// job only adds new findings.
import { config } from "../config.js";
import { prisma } from "../db.js";

export interface ReconciliationResult {
  exitWithoutEntry: number;
  entryNeverClosed: number;
  staleVisit: number;
}

export async function runReconciliation(now = new Date()): Promise<ReconciliationResult> {
  const exitWithoutEntry = await prisma.$executeRaw`
    INSERT INTO reconciliation_flags (id, kind, subject_id, gate_event_id, details, created_at)
    SELECT gen_random_uuid(), 'exit_without_entry', e.id, e.id,
           'Exit of ' || e.plate_normalized || ' with no matching entry', now()
    FROM gate_events e
    WHERE e.direction = 'exit' AND e.match_result = 'resident' AND e.paired_event_id IS NULL
      AND e.captured_at <= ${now}
    ON CONFLICT (kind, subject_id) DO NOTHING`;

  const entryNeverClosed = await prisma.$executeRaw`
    INSERT INTO reconciliation_flags (id, kind, subject_id, gate_event_id, details, created_at)
    SELECT gen_random_uuid(), 'entry_never_closed', e.id, e.id,
           'Entry of ' || e.plate_normalized || ' was never closed by an exit', now()
    FROM gate_events e
    WHERE e.direction = 'entry' AND e.match_result = 'resident' AND e.vehicle_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM gate_events x WHERE x.paired_event_id = e.id)
      AND EXISTS (
        SELECT 1 FROM gate_events later
        WHERE later.vehicle_id = e.vehicle_id AND later.direction = 'entry'
          AND later.captured_at > e.captured_at AND later.captured_at <= ${now})
    ON CONFLICT (kind, subject_id) DO NOTHING`;

  const staleBefore = new Date(now.getTime() - config.RECONCILIATION_STALE_HOURS * 3_600_000);
  const staleVisit = await prisma.$executeRaw`
    INSERT INTO reconciliation_flags (id, kind, subject_id, visit_id, details, created_at)
    SELECT gen_random_uuid(), 'stale_visit', v.id, v.id,
           'Visit still ' || v.status::text || ' more than a day past its time limit', now()
    FROM visits v
    WHERE v.status IN ('inside', 'overstayed', 'escalated') AND v.expected_exit_at < ${staleBefore}
    ON CONFLICT (kind, subject_id) DO NOTHING`;

  return { exitWithoutEntry, entryNeverClosed, staleVisit };
}
