// Gate event engine: one camera read in → one decision out (brief §10.1, §10.2, §10.3).
//
//   1. Repair the plate (plates.ts).
//   2. Idempotency: the same read sent twice (a retry) returns the first result ("duplicate").
//   3. Debounce: the same plate on the same camera within 30 s is the same car ("debounced").
//   4. Match, in this order: watchlist (even for low-confidence reads) → low confidence /
//      unreadable (review queue) → resident vehicle → expected visitor → unknown.
//   5. Side effects: alert, entry/exit pairing, visit enter/exit.
//
// Everything for one read happens in ONE transaction, holding an advisory lock for
// (camera, plate), so two copies of the same read can never both be stored.
import { createHash, randomUUID } from "node:crypto";
import { config } from "../config.js";
import { prisma, type Tx, withTx } from "../db.js";
import type {
  GateEvent,
  LaneDirection,
  MatchResult,
  VisitStatus,
} from "../../generated/prisma/client.js";
import { bestMatch, type Candidate, cleanPlate, repairPlate } from "./plates.js";
import { IllegalTransitionError } from "./visitState.js";
import { admitWithPass } from "./guestPasses.js";
import { effectiveSettings, transitionVisit } from "./visits.js";

export interface CameraRead {
  deviceId: string;
  gateId: string;
  direction: LaneDirection;
  plateText: string;
  /** OCR confidence, 0–1. */
  confidence: number;
  capturedAt: Date;
  /** Id to use if a new event is created (so a snapshot can be saved under it beforehand). */
  eventId?: string;
  snapshotKey?: string | null;
}

export type IngestStatus = "created" | "duplicate" | "debounced";

export interface IngestResult {
  status: IngestStatus;
  event: GateEvent;
}

/** The plate we store and match: the repaired plate, or the cleaned text if unreadable. */
export function readPlate(plateText: string): { plate: string; fixes: number; readable: boolean } {
  const repair = repairPlate(plateText);
  if (repair) return { plate: repair.plate, fixes: repair.fixes, readable: true };
  return { plate: cleanPlate(plateText) || "UNREADABLE", fixes: 0, readable: false };
}

/** sha256(device | repaired plate | capturedAt to the millisecond). */
export function eventHash(deviceId: string, plate: string, capturedAt: Date): string {
  return createHash("sha256")
    .update(`${deviceId}|${plate}|${capturedAt.toISOString()}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface Decision {
  matchResult: MatchResult;
  matchDistance: number | null;
  vehicleId: string | null;
  visitId: string | null;
  /** Set when an active guest pass for this plate admits the car. */
  guestPassId: string | null;
  needsReview: boolean;
  reviewReason: string | null;
  /** Set when the plate is on the watchlist. */
  watchlist: { id: string; reason: string } | null;
}

/** Statuses of visits a camera on this lane is waiting for. */
const EXPECTED: Record<LaneDirection, VisitStatus[]> = {
  entry: ["approved"],
  exit: ["inside", "overstayed", "escalated"],
};

/**
 * Load only (plate, id) pairs whose length is within the fuzzy distance, so the in-memory
 * comparison stays small however big the society gets (brief §17).
 */
type Known = "vehicle" | "visit" | "pass";

async function candidates(tx: Tx, plate: string, direction: LaneDirection, at: Date) {
  const d = config.PLATE_FUZZY_MAX_DISTANCE;
  const [lo, hi] = [plate.length - d, plate.length + d];
  // Guest passes only admit cars, so they are candidates on the entry lane only.
  const passes =
    direction === "entry"
      ? tx.$queryRaw<{ id: string; plate: string }[]>`
          SELECT id::text, plate_normalized AS plate FROM guest_passes
          WHERE plate_normalized IS NOT NULL AND revoked_at IS NULL
            AND valid_from <= ${at} AND valid_until > ${at} AND use_count < max_uses
            AND char_length(plate_normalized) BETWEEN ${lo} AND ${hi}`
      : Promise.resolve([]);
  const [watch, vehicles, visits, guestPasses] = await Promise.all([
    tx.$queryRaw<{ id: string; plate: string }[]>`
      SELECT id::text, plate_normalized AS plate FROM watchlist
      WHERE is_active AND char_length(plate_normalized) BETWEEN ${lo} AND ${hi}`,
    tx.$queryRaw<{ id: string; plate: string }[]>`
      SELECT id::text, plate_normalized AS plate FROM vehicles
      WHERE is_active AND char_length(plate_normalized) BETWEEN ${lo} AND ${hi}`,
    tx.$queryRaw<{ id: string; plate: string }[]>`
      SELECT id::text, plate_normalized AS plate FROM visits
      WHERE status::text = ANY(${EXPECTED[direction]})
        AND plate_normalized IS NOT NULL
        AND char_length(plate_normalized) BETWEEN ${lo} AND ${hi}`,
    passes,
  ]);
  return {
    watchlist: watch.map((r): Candidate<"watchlist"> => ({ ...r, kind: "watchlist" })),
    known: [
      ...vehicles.map((r): Candidate<Known> => ({ ...r, kind: "vehicle" })),
      ...visits.map((r): Candidate<Known> => ({ ...r, kind: "visit" })),
      ...guestPasses.map((r): Candidate<Known> => ({ ...r, kind: "pass" })),
    ],
  };
}

/** Decide what a read means. Reads the database, writes nothing. */
export async function decide(
  tx: Tx,
  read: {
    plate: string;
    readable: boolean;
    confidence: number;
    direction: LaneDirection;
    at: Date;
  },
): Promise<Decision> {
  const maxDistance = config.PLATE_FUZZY_MAX_DISTANCE;
  const pool = await candidates(tx, read.plate, read.direction, read.at);
  const threshold = (await effectiveSettings(tx)).confidenceThreshold;
  const lowConfidence = !read.readable || read.confidence < threshold;
  const reviewReason = !read.readable
    ? "Plate could not be read as a valid Indian plate"
    : lowConfidence
      ? `Low OCR confidence (${read.confidence.toFixed(2)} < ${threshold.toFixed(2)})`
      : null;
  const base: Decision = {
    matchResult: "unknown",
    matchDistance: null,
    vehicleId: null,
    visitId: null,
    guestPassId: null,
    needsReview: false,
    reviewReason: null,
    watchlist: null,
  };

  // 1. Watchlist first, even for low-confidence reads: a possible hit must reach the guard.
  const watch = bestMatch(read.plate, pool.watchlist, maxDistance);
  if (watch.type !== "none") {
    const hit = watch.type === "match" ? watch.candidate : watch.candidates[0];
    const entry = hit
      ? await tx.watchlistEntry.findUnique({ where: { id: hit.id }, select: { reason: true } })
      : null;
    return {
      ...base,
      matchResult: "watchlist",
      matchDistance: watch.distance,
      needsReview: lowConfidence,
      reviewReason,
      watchlist: hit && entry ? { id: hit.id, reason: entry.reason } : null,
    };
  }

  // 2. Unclear reads go to a guard instead of being guessed.
  if (lowConfidence)
    return { ...base, matchResult: "low_confidence", needsReview: true, reviewReason };

  // 3–4. Residents' vehicles and visitors expected at this lane; exact beats fuzzy; ties → guard.
  const known = bestMatch(read.plate, pool.known, maxDistance);
  if (known.type === "ambiguous") {
    return {
      ...base,
      matchResult: "ambiguous",
      matchDistance: known.distance,
      needsReview: true,
      reviewReason: `Equally close to ${known.candidates.map((c) => c.plate).join(", ")}`,
    };
  }
  if (known.type === "match") {
    const { candidate, distance } = known;
    if (candidate.kind === "vehicle")
      return { ...base, matchResult: "resident", matchDistance: distance, vehicleId: candidate.id };
    if (candidate.kind === "pass")
      return {
        ...base,
        matchResult: "guest_pass",
        matchDistance: distance,
        guestPassId: candidate.id,
      };
    return { ...base, matchResult: "visitor", matchDistance: distance, visitId: candidate.id };
  }

  // 5. Nobody we know: the guard registers the visitor.
  return base;
}

/**
 * Apply a decision's side effects to a stored event: watchlist alert, pairing a resident's exit
 * with their open entry, or moving an expected visit inside / out.
 */
export async function applyDecision(
  tx: Tx,
  event: GateEvent,
  decision: Decision,
): Promise<GateEvent> {
  if (decision.watchlist) {
    const already = await tx.alert.findFirst({
      where: { gateEventId: event.id, kind: "watchlist" },
    });
    if (!already) {
      const gate = await tx.gate.findUniqueOrThrow({
        where: { id: event.gateId },
        select: { name: true },
      });
      await tx.alert.create({
        data: {
          gateEventId: event.id,
          kind: "watchlist",
          severity: "critical",
          message: `Watchlist plate ${event.plateNormalized} at ${gate.name} (${event.direction}): ${decision.watchlist.reason}`,
        },
      });
    }
  }

  if (decision.matchResult === "resident" && decision.vehicleId && event.direction === "exit") {
    // Pair this exit with the vehicle's latest entry that no exit has closed yet.
    const open = await tx.$queryRaw<{ id: string }[]>`
      SELECT e.id::text FROM gate_events e
      WHERE e.vehicle_id = ${decision.vehicleId}::uuid
        AND e.direction = 'entry'
        AND e.id <> ${event.id}::uuid
        AND e.captured_at <= ${event.capturedAt}
        AND NOT EXISTS (SELECT 1 FROM gate_events x WHERE x.paired_event_id = e.id)
      ORDER BY e.captured_at DESC
      LIMIT 1
      FOR UPDATE OF e`;
    const entry = open[0];
    if (entry) {
      return tx.gateEvent.update({ where: { id: event.id }, data: { pairedEventId: entry.id } });
    }
  }

  if (decision.matchResult === "guest_pass" && decision.guestPassId) {
    // Use up one entry of the pass (conditional update: never more uses than allowed), then
    // create the visit already approved and move it inside.
    const visit = await admitWithPass(tx, decision.guestPassId, {
      plate: event.plateNormalized,
      at: event.capturedAt,
      gateEventId: event.id,
      actorUserId: null,
    });
    if (!visit) {
      return tx.gateEvent.update({
        where: { id: event.id },
        data: { needsReview: true, reviewReason: "Guest pass was used up or revoked a moment ago" },
      });
    }
    return tx.gateEvent.update({ where: { id: event.id }, data: { visitId: visit.id } });
  }

  if (decision.matchResult === "visitor" && decision.visitId) {
    try {
      await transitionVisit(tx, decision.visitId, event.direction === "entry" ? "enter" : "exit", {
        at: event.capturedAt,
        gateEventId: event.id,
      });
    } catch (err) {
      // The visit changed state between matching and locking (e.g. a guard just closed it).
      // Never drop the car: keep the read and hand it to a guard.
      if (!(err instanceof IllegalTransitionError)) throw err;
      return tx.gateEvent.update({
        where: { id: event.id },
        data: {
          needsReview: true,
          reviewReason: `Visit could not ${err.trigger}: it is now "${err.from}"`,
        },
      });
    }
  }
  return event;
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

/** Store one camera read (or recognise it as a retry / the same car) and act on it. */
export async function ingestRead(read: CameraRead): Promise<IngestResult> {
  const { plate, fixes, readable } = readPlate(read.plateText);
  const hash = eventHash(read.deviceId, plate, read.capturedAt);

  try {
    return await withTx(async (tx) => {
      // Serialise all work on this (camera, plate) pair for the rest of the transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${read.deviceId}|${plate}`}, 0))`;

      const existing = await tx.gateEvent.findUnique({ where: { eventHash: hash } });
      if (existing) return { status: "duplicate", event: existing };

      // Same car still in front of the camera? Compare camera times, not arrival times, so reads
      // replayed later from the offline buffer stay separate events.
      // Two-sided: the read must fall within 30 s of an event's [capturedAt, lastSeenAt] span, so
      // an old read replayed after a newer event of the same plate is NOT folded into it.
      const cooldownMs = config.GATE_EVENT_COOLDOWN_SECONDS * 1000;
      const recent = await tx.gateEvent.findFirst({
        where: {
          deviceId: read.deviceId,
          plateNormalized: plate,
          lastSeenAt: { gte: new Date(read.capturedAt.getTime() - cooldownMs) },
          capturedAt: { lte: new Date(read.capturedAt.getTime() + cooldownMs) },
        },
        orderBy: { lastSeenAt: "desc" },
      });
      if (recent) {
        const lastSeenAt =
          recent.lastSeenAt > read.capturedAt ? recent.lastSeenAt : read.capturedAt;
        const event = await tx.gateEvent.update({ where: { id: recent.id }, data: { lastSeenAt } });
        return { status: "debounced", event };
      }

      const decision = await decide(tx, {
        plate,
        readable,
        confidence: read.confidence,
        direction: read.direction,
        at: read.capturedAt,
      });
      const created = await tx.gateEvent.create({
        data: {
          id: read.eventId ?? randomUUID(),
          deviceId: read.deviceId,
          gateId: read.gateId,
          direction: read.direction,
          plateRaw: read.plateText,
          plateNormalized: plate,
          ocrFixes: fixes,
          confidence: read.confidence,
          snapshotKey: read.snapshotKey ?? null,
          capturedAt: read.capturedAt,
          lastSeenAt: read.capturedAt,
          eventHash: hash,
          matchResult: decision.matchResult,
          matchDistance: decision.matchDistance,
          vehicleId: decision.vehicleId,
          visitId: decision.visitId,
          needsReview: decision.needsReview,
          reviewReason: decision.reviewReason,
        },
      });
      return { status: "created", event: await applyDecision(tx, created, decision) };
    });
  } catch (err) {
    // Belt and braces: if two copies still raced past the lock, the unique hash rejects one.
    const winner = await prisma.gateEvent.findUnique({ where: { eventHash: hash } });
    if (winner) return { status: "duplicate", event: winner };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Guard review
// ---------------------------------------------------------------------------

export type ReviewAction = { action: "dismiss" } | { action: "correct"; plate: string };

/** Errors the route turns into 404 / 409. */
export class ReviewError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A guard settles a read from the review queue, once. "correct" stores the guard's plate as
 * labelled data and re-runs matching with it (a human read counts as fully confident).
 */
export async function reviewEvent(
  eventId: string,
  guardId: string,
  review: ReviewAction,
): Promise<GateEvent> {
  return withTx(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id::text FROM gate_events WHERE id = ${eventId}::uuid FOR UPDATE`;
    if (!rows[0]) throw new ReviewError(404, "Gate event not found");
    const event = await tx.gateEvent.findUniqueOrThrow({ where: { id: eventId } });
    if (event.reviewedAt) throw new ReviewError(409, "This read was already reviewed");
    if (!event.needsReview) throw new ReviewError(409, "This read does not need review");

    const now = new Date();
    if (review.action === "dismiss") {
      return tx.gateEvent.update({
        where: { id: eventId },
        data: { needsReview: false, reviewedAt: now, reviewedById: guardId },
      });
    }

    await tx.plateCorrection.create({
      data: {
        gateEventId: eventId,
        originalPlate: event.plateNormalized,
        correctedPlate: review.plate,
        guardId,
      },
    });
    const decision = await decide(tx, {
      plate: review.plate,
      readable: true,
      confidence: 1,
      direction: event.direction,
      at: event.capturedAt,
    });
    const updated = await tx.gateEvent.update({
      where: { id: eventId },
      data: {
        plateNormalized: review.plate,
        matchResult: decision.matchResult,
        matchDistance: decision.matchDistance,
        vehicleId: decision.vehicleId,
        visitId: decision.visitId,
        needsReview: false,
        reviewedAt: now,
        reviewedById: guardId,
      },
    });
    return applyDecision(tx, updated, decision);
  });
}
