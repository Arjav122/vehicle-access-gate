// Resident approvals (brief §10.4).
// - One approvals row per visit, locked FOR UPDATE while deciding: two residents tapping at once
//   are served one after the other; the first answer wins. The same answer again is fine (200),
//   a different one is refused (409). Web (and later Telegram) call the same function.
// - Approvals expire: a job every 15 s marks overdue ones timed_out, and every late answer checks
//   the clock itself. After that the guard decides.
// - If the guard registered the visitor against the waiting car's read, approving lets that car
//   in at once (visit → inside); otherwise the visit waits as approved for a camera read.
import type { Tx } from "../db.js";
import { withTx } from "../db.js";
import type { Approval, ApprovalChannel, Visit } from "../../generated/prisma/client.js";
import { queueEmail, templates } from "./notifications.js";
import { admitWaitingCar, effectiveSettings, flatIdsOf, transitionVisit } from "./visits.js";

export type Answer = "approve" | "deny";

export class ApprovalError extends Error {
  constructor(
    readonly status: 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** Ask the flat's residents. Expires after the society's approval timeout. */
export async function requestApproval(tx: Tx, visitId: string, now: Date): Promise<Approval> {
  const { approvalTimeoutSeconds } = await effectiveSettings(tx);
  return tx.approval.create({
    data: {
      visitId,
      status: "pending",
      expiresAt: new Date(now.getTime() + approvalTimeoutSeconds * 1000),
    },
  });
}

async function lockApproval(
  tx: Tx,
  where: { id?: string; visitId?: string },
): Promise<Approval | null> {
  const rows = where.id
    ? await tx.$queryRaw<
        { id: string }[]
      >`SELECT id::text FROM approvals WHERE id = ${where.id}::uuid FOR UPDATE`
    : await tx.$queryRaw<
        { id: string }[]
      >`SELECT id::text FROM approvals WHERE visit_id = ${where.visitId ?? ""}::uuid FOR UPDATE`;
  const row = rows[0];
  return row ? tx.approval.findUniqueOrThrow({ where: { id: row.id } }) : null;
}

const STATUS_OF: Record<Answer, "approved" | "denied"> = { approve: "approved", deny: "denied" };

export interface DecisionResult {
  approval: Approval;
  visit: Visit;
  /** false when this exact answer had already been given (nothing changed). */
  changed: boolean;
  /** true when the approval had just run out: nothing was decided, the guard decides now. */
  timedOut: boolean;
}

/** Tell the visitor (if they gave an email) that the visit is approved, via the outbox. */
async function emailVisitorApproved(tx: Tx, visitId: string): Promise<void> {
  const v = await tx.visit.findUniqueOrThrow({
    where: { id: visitId },
    include: { flat: true, visitor: true },
  });
  if (!v.visitor?.email) return;
  await queueEmail(tx, {
    kind: "visit_approved",
    to: v.visitor.email,
    key: `visit:${v.id}:approved:visitor`,
    message: templates.visitApproved({
      flatLabel: `${v.flat.block}-${v.flat.number}`,
      visitorName: v.visitor.fullName,
      plate: v.plateNormalized,
      category: v.category,
      expectedExitAt: v.expectedExitAt,
    }),
  });
}

/** Apply an answer to a pending approval: approval row, visit move, and the waiting car. */
async function applyAnswer(
  tx: Tx,
  approval: Approval,
  answer: Answer,
  actorUserId: string,
  channel: ApprovalChannel,
  now: Date,
  keepStatus = false,
): Promise<DecisionResult> {
  const updated = await tx.approval.update({
    where: { id: approval.id },
    data: {
      ...(keepStatus ? {} : { status: STATUS_OF[answer] }),
      channel,
      decidedById: actorUserId,
      decidedAt: now,
    },
  });
  let visit = await transitionVisit(tx, approval.visitId, answer, { at: now, actorUserId });
  if (answer === "approve" && (await admitWaitingCar(tx, visit.id, now, actorUserId))) {
    visit = await tx.visit.findUniqueOrThrow({ where: { id: visit.id } });
  }
  if (answer === "approve") await emailVisitorApproved(tx, visit.id);
  return { approval: updated, visit, changed: true, timedOut: false };
}

/**
 * A resident answers. Throws ApprovalError: 404 (not theirs / not found), 409 (different answer
 * already given). Returns timedOut=true (and records it) when the answer came too late.
 */
export async function residentDecides(
  approvalId: string,
  residentUserId: string,
  answer: Answer,
  channel: ApprovalChannel = "web",
  now = new Date(),
): Promise<DecisionResult> {
  return withTx(async (tx) => {
    const approval = await lockApproval(tx, { id: approvalId });
    if (!approval) throw new ApprovalError(404, "Approval not found");
    const visit = await tx.visit.findUniqueOrThrow({ where: { id: approval.visitId } });
    if (!(await flatIdsOf(tx, residentUserId)).includes(visit.flatId)) {
      throw new ApprovalError(404, "Approval not found"); // don't reveal other flats' visitors
    }

    if (approval.status === "approved" || approval.status === "denied") {
      if (approval.status === STATUS_OF[answer])
        return { approval, visit, changed: false, timedOut: false };
      throw new ApprovalError(409, `Already ${approval.status}; the first answer counts`);
    }
    if (approval.status === "timed_out" || now >= approval.expiresAt) {
      const expired =
        approval.status === "timed_out"
          ? approval
          : await tx.approval.update({ where: { id: approval.id }, data: { status: "timed_out" } });
      return { approval: expired, visit, changed: approval.status !== "timed_out", timedOut: true };
    }
    return applyAnswer(tx, approval, answer, residentUserId, channel, now);
  });
}

/**
 * The guard decides after the residents' time is up. 409 while residents can still answer,
 * or when a different answer was already given.
 */
export async function guardDecides(
  visitId: string,
  guardId: string,
  answer: Answer,
  now = new Date(),
): Promise<DecisionResult> {
  return withTx(async (tx) => {
    const approval = await lockApproval(tx, { visitId });
    if (!approval) throw new ApprovalError(409, "This visit is not waiting for a decision");
    const visit = await tx.visit.findUniqueOrThrow({ where: { id: visitId } });

    if (approval.status === "approved" || approval.status === "denied") {
      if (approval.status === STATUS_OF[answer])
        return { approval, visit, changed: false, timedOut: false };
      throw new ApprovalError(409, `Already ${approval.status}`);
    }
    if (approval.status === "pending" && now < approval.expiresAt) {
      const seconds = Math.ceil((approval.expiresAt.getTime() - now.getTime()) / 1000);
      throw new ApprovalError(409, `Residents can still answer for ${String(seconds)} s`);
    }
    if (approval.decidedAt) {
      // timed_out and already settled by a guard: same rule as above
      const settled = visit.status === "denied" ? "deny" : "approve";
      if (settled === answer) return { approval, visit, changed: false, timedOut: false };
      throw new ApprovalError(
        409,
        `Already ${settled === "approve" ? "approved" : "denied"} by a guard`,
      );
    }
    if (approval.status === "pending") {
      await tx.approval.update({ where: { id: approval.id }, data: { status: "timed_out" } });
    }
    // The approval stays "timed_out" (residents did not answer); who decided is recorded on it.
    return applyAnswer(
      tx,
      { ...approval, status: "timed_out" },
      answer,
      guardId,
      "guard",
      now,
      true,
    );
  });
}

/** The 15-second job: hand every overdue approval to the guard. Returns what it expired. */
export async function expireApprovals(now = new Date()): Promise<Approval[]> {
  return withTx(async (tx) => {
    const due = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM approvals WHERE status = 'pending' AND expires_at <= ${now}
      FOR UPDATE SKIP LOCKED`;
    if (!due.length) return [];
    const ids = due.map((d) => d.id);
    await tx.approval.updateMany({ where: { id: { in: ids } }, data: { status: "timed_out" } });
    return tx.approval.findMany({ where: { id: { in: ids } } });
  });
}

/** Approvals for display, with seconds left (0 once expired). */
export function secondsLeft(
  approval: Pick<Approval, "status" | "expiresAt">,
  now = new Date(),
): number {
  if (approval.status !== "pending") return 0;
  return Math.max(0, Math.ceil((approval.expiresAt.getTime() - now.getTime()) / 1000));
}
