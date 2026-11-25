// Visits: creation and the ONLY function that changes a visit's status (brief §10.3).
// Every change locks the visit row, asks the pure state machine for the next status, applies
// the side data (entered/exited times, expected exit), and writes an append-only history row,
// all in the caller's transaction.
import { config } from "../config.js";
import type { Tx } from "../db.js";
import type { Visit, VisitCategory, VisitStatus } from "../../generated/prisma/client.js";
import { INITIAL_STATUSES, nextStatus, type Trigger } from "./visitState.js";

export interface EffectiveSettings {
  guestMinutes: number;
  deliveryMinutes: number;
  cabMinutes: number;
  serviceMinutes: number;
  approvalTimeoutSeconds: number;
  confidenceThreshold: number;
  visitorRetentionDays: number;
}

/** The society's settings: the admin's saved row if there is one, else the config defaults. */
export async function effectiveSettings(
  db: Pick<Tx, "societySettings">,
): Promise<EffectiveSettings> {
  const s = await db.societySettings.findUnique({ where: { id: 1 } });
  return {
    guestMinutes: s?.guestMinutes ?? config.VISIT_LIMIT_GUEST_MINUTES,
    deliveryMinutes: s?.deliveryMinutes ?? config.VISIT_LIMIT_DELIVERY_MINUTES,
    cabMinutes: s?.cabMinutes ?? config.VISIT_LIMIT_CAB_MINUTES,
    serviceMinutes: s?.serviceMinutes ?? config.VISIT_LIMIT_SERVICE_MINUTES,
    approvalTimeoutSeconds: s?.approvalTimeoutSeconds ?? config.APPROVAL_TIMEOUT_SECONDS,
    confidenceThreshold: s?.confidenceThreshold ?? config.PLATE_CONFIDENCE_THRESHOLD,
    visitorRetentionDays: s?.visitorRetentionDays ?? config.VISITOR_RETENTION_DAYS,
  };
}

/** Time limit for a visit category, in minutes. */
export async function categoryLimitMinutes(tx: Tx, category: VisitCategory): Promise<number> {
  const s = await effectiveSettings(tx);
  const limits: Record<VisitCategory, number> = {
    guest: s.guestMinutes,
    delivery: s.deliveryMinutes,
    cab: s.cabMinutes,
    service: s.serviceMinutes,
  };
  return limits[category];
}

/** Ids of the flats a resident user belongs to (empty for staff). */
export async function flatIdsOf(db: Pick<Tx, "resident">, userId: string): Promise<string[]> {
  const rows = await db.resident.findMany({
    where: { userId, user: { isActive: true } },
    select: { flatId: true },
  });
  return rows.map((r) => r.flatId);
}

/**
 * Let in the car that was waiting at the barrier when the guard registered the visitor:
 * the registered gate event becomes the visit's entry, timed now (when the barrier opens).
 */
export async function admitWaitingCar(
  tx: Tx,
  visitId: string,
  at: Date,
  actorUserId: string | null,
): Promise<boolean> {
  const waiting = await tx.gateEvent.findFirst({
    where: { visitId, direction: "entry", entryOf: null },
    orderBy: { capturedAt: "desc" },
    select: { id: true },
  });
  if (!waiting) return false;
  await transitionVisit(tx, visitId, "enter", { at, actorUserId, gateEventId: waiting.id });
  return true;
}

export interface CreateVisitInput {
  flatId: string;
  category: VisitCategory;
  status: VisitStatus;
  visitorId?: string | null;
  guestPassId?: string | null;
  plateNormalized?: string | null;
  purpose?: string | null;
  agreedDurationMinutes?: number | null;
  createdById?: string | null;
  at?: Date;
}

/** Create a visit in one of its starting statuses, with its first history row. */
export async function createVisit(tx: Tx, input: CreateVisitInput): Promise<Visit> {
  if (!INITIAL_STATUSES.includes(input.status)) {
    throw new Error(`A visit cannot start as "${input.status}"`);
  }
  const at = input.at ?? new Date();
  const visit = await tx.visit.create({
    data: {
      flatId: input.flatId,
      category: input.category,
      status: input.status,
      visitorId: input.visitorId ?? null,
      guestPassId: input.guestPassId ?? null,
      plateNormalized: input.plateNormalized ?? null,
      purpose: input.purpose ?? null,
      agreedDurationMinutes: input.agreedDurationMinutes ?? null,
      createdById: input.createdById ?? null,
      // When it happened (a camera read's capturedAt, or the seed's history), not insert time.
      createdAt: at,
    },
  });
  await tx.visitStatusChange.create({
    data: {
      visitId: visit.id,
      fromStatus: null,
      toStatus: input.status,
      trigger: "create",
      actorUserId: input.createdById ?? null,
      changedAt: at,
    },
  });
  return visit;
}

export interface TransitionInput {
  /** When it happened. Camera triggers pass the read's capturedAt, not "now". */
  at: Date;
  actorUserId?: string | null;
  gateEventId?: string | null;
}

/**
 * Move a visit with one of the 7 triggers. Throws IllegalTransitionError (→ 409) for a move the
 * state machine does not allow; nothing is written in that case.
 */
export async function transitionVisit(
  tx: Tx,
  visitId: string,
  trigger: Trigger,
  input: TransitionInput,
): Promise<Visit> {
  // Lock the row: two triggers on the same visit (e.g. a camera exit and a guard's manual exit)
  // are applied one after the other, and the second sees the first's result.
  const rows = await tx.$queryRaw<{ status: VisitStatus }[]>`
    SELECT status FROM visits WHERE id = ${visitId}::uuid FOR UPDATE`;
  const current = rows[0];
  if (!current) throw new Error(`Visit ${visitId} not found`);

  const to = nextStatus(current.status, trigger);
  const visit = await tx.visit.findUniqueOrThrow({ where: { id: visitId } });

  const data: Parameters<Tx["visit"]["update"]>[0]["data"] = { status: to };
  if (trigger === "enter") {
    const minutes = visit.agreedDurationMinutes ?? (await categoryLimitMinutes(tx, visit.category));
    data.enteredAt = input.at;
    data.expectedExitAt = new Date(input.at.getTime() + minutes * 60_000);
    if (input.gateEventId) data.entryEvent = { connect: { id: input.gateEventId } };
  }
  if (trigger === "exit") {
    data.exitedAt = input.at;
    if (visit.enteredAt) {
      data.durationMinutes = Math.max(
        0,
        Math.round((input.at.getTime() - visit.enteredAt.getTime()) / 60_000),
      );
    }
    if (input.gateEventId) data.exitEvent = { connect: { id: input.gateEventId } };
  }
  if (trigger === "approve" && input.actorUserId)
    data.approvedBy = { connect: { id: input.actorUserId } };

  const updated = await tx.visit.update({ where: { id: visitId }, data });
  await tx.visitStatusChange.create({
    data: {
      visitId,
      fromStatus: current.status,
      toStatus: to,
      trigger,
      actorUserId: input.actorUserId ?? null,
      gateEventId: input.gateEventId ?? null,
      changedAt: input.at,
    },
  });

  // Any exit closes an open "call the resident" task: the car has left (brief §10.6).
  if (trigger === "exit") {
    await tx.escalationTask.updateMany({
      where: { visitId, status: "open" },
      data: { status: "resolved", outcome: "vehicle_left", resolvedAt: input.at },
    });
  }
  return updated;
}

export class VisitError extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

export interface RegisterInput {
  flatId: string;
  category: VisitCategory;
  visitor: { fullName: string; phone?: string | null; email?: string | null };
  purpose?: string | null;
  plate?: string | null;
  /** The waiting car's read: links it, so approval lets it in at once. */
  gateEventId?: string | null;
  agreedDurationMinutes?: number | null;
}

/**
 * The guard registers a visitor: visitor row, visit (pending_approval), approval request, and
 * the waiting car's read linked to the visit. Registering the same car twice is refused (409),
 * which stops the classic double registration when two guards act at once (brief §17).
 */
export async function registerVisit(
  tx: Tx,
  input: RegisterInput,
  guardId: string,
  now: Date,
  request: (tx: Tx, visitId: string, now: Date) => Promise<unknown>,
): Promise<Visit> {
  const flat = await tx.flat.findUnique({ where: { id: input.flatId }, select: { id: true } });
  if (!flat) throw new VisitError(404, "Flat not found");

  let plate = input.plate ?? null;
  if (input.gateEventId) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM gate_events WHERE id = ${input.gateEventId}::uuid FOR UPDATE`;
    if (!rows[0]) throw new VisitError(404, "Gate event not found");
    const event = await tx.gateEvent.findUniqueOrThrow({ where: { id: input.gateEventId } });
    if (event.visitId) throw new VisitError(409, "This car is already registered for a visit");
    if (event.direction !== "entry")
      throw new VisitError(422, "Only an entry-lane read can be registered");
    plate = event.plateNormalized;
  }

  const visitor = await tx.visitor.create({
    data: {
      fullName: input.visitor.fullName,
      phone: input.visitor.phone ?? null,
      email: input.visitor.email ?? null,
    },
  });
  const visit = await createVisit(tx, {
    flatId: input.flatId,
    category: input.category,
    status: "pending_approval",
    visitorId: visitor.id,
    plateNormalized: plate,
    purpose: input.purpose ?? null,
    agreedDurationMinutes: input.agreedDurationMinutes ?? null,
    createdById: guardId,
    at: now,
  });
  if (input.gateEventId) {
    await tx.gateEvent.update({ where: { id: input.gateEventId }, data: { visitId: visit.id } });
  }
  await request(tx, visit.id, now);
  return visit;
}
