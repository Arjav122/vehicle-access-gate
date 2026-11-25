// Visits: creation and the ONLY function that changes a visit's status (brief §10.3).
// Every change locks the visit row, asks the pure state machine for the next status, applies
// the side data (entered/exited times, expected exit), and writes an append-only history row,
// all in the caller's transaction.
import { config } from "../config.js";
import type { Tx } from "../db.js";
import type { Visit, VisitCategory, VisitStatus } from "../../generated/prisma/client.js";
import { INITIAL_STATUSES, nextStatus, type Trigger } from "./visitState.js";

/** Time limit for a visit category, in minutes: society settings, else config defaults. */
export async function categoryLimitMinutes(tx: Tx, category: VisitCategory): Promise<number> {
  const s = await tx.societySettings.findUnique({ where: { id: 1 } });
  const limits: Record<VisitCategory, number> = {
    guest: s?.guestMinutes ?? config.VISIT_LIMIT_GUEST_MINUTES,
    delivery: s?.deliveryMinutes ?? config.VISIT_LIMIT_DELIVERY_MINUTES,
    cab: s?.cabMinutes ?? config.VISIT_LIMIT_CAB_MINUTES,
    service: s?.serviceMinutes ?? config.VISIT_LIMIT_SERVICE_MINUTES,
  };
  return limits[category];
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
