// The overstay escalation ladder (brief §10.6), driven by a clock that is passed in.
//
//   time limit reached     → visit overstayed, email visitor + residents
//   limit + 30 min         → reminder email to residents (and visitor)
//   limit + 60 min         → visit escalated, "call the resident" task for the guard
//
// `dueSteps` is pure: given a visit's status and limit and "now", which steps are due. `runLadder`
// applies them, each idempotently: the state machine refuses a second overstay/escalate, email
// keys are unique, and there is at most one task per visit. Running it twice, or once after an
// outage, does every due step exactly once and in order. Steps are timed when they were due
// (not when the job happened to run), so history stays correct after an outage.
import { config } from "../config.js";
import { prisma, type Tx, withTx } from "../db.js";
import type { VisitStatus } from "../../generated/prisma/enums.js";
import { queueEmail, templates, type VisitFacts } from "./notifications.js";
import { transitionVisit } from "./visits.js";

export type Step = "overstay" | "reminder" | "escalate";

export interface LadderTimes {
  reminderMinutes: number;
  escalationMinutes: number;
}

export const defaultTimes = (): LadderTimes => ({
  reminderMinutes: config.OVERSTAY_REMINDER_MINUTES,
  escalationMinutes: config.OVERSTAY_ESCALATION_MINUTES,
});

/** Which steps are due for a visit right now, in order. Pure. */
export function dueSteps(
  visit: { status: VisitStatus; expectedExitAt: Date | null },
  now: Date,
  times: LadderTimes = defaultTimes(),
): Step[] {
  if (!visit.expectedExitAt) return [];
  const limit = visit.expectedExitAt.getTime();
  const t = now.getTime();
  const steps: Step[] = [];
  let status = visit.status;
  if (status === "inside" && t >= limit) {
    steps.push("overstay");
    status = "overstayed";
  }
  const pastReminder = t >= limit + times.reminderMinutes * 60_000;
  if ((status === "overstayed" || status === "escalated") && pastReminder) steps.push("reminder");
  if (status === "overstayed" && t >= limit + times.escalationMinutes * 60_000)
    steps.push("escalate");
  return steps;
}

export interface LadderOutcome {
  visitId: string;
  flatId: string;
  steps: Step[];
  escalationTaskId: string | null;
}

async function factsAndRecipients(tx: Tx, visitId: string) {
  const v = await tx.visit.findUniqueOrThrow({
    where: { id: visitId },
    include: { flat: true, visitor: true },
  });
  const residents = await tx.resident.findMany({
    where: { flatId: v.flatId, user: { isActive: true } },
    select: { user: { select: { id: true, email: true } } },
  });
  const facts: VisitFacts = {
    flatLabel: `${v.flat.block}-${v.flat.number}`,
    visitorName: v.visitor?.fullName ?? null,
    plate: v.plateNormalized,
    category: v.category,
    expectedExitAt: v.expectedExitAt,
  };
  return {
    visit: v,
    facts,
    residents: residents.map((r) => r.user),
    visitorEmail: v.visitor?.email ?? null,
  };
}

async function applySteps(
  tx: Tx,
  visitId: string,
  now: Date,
  times: LadderTimes,
): Promise<LadderOutcome | null> {
  // Lock first, then decide from the fresh state (two runs at once cannot both act).
  await tx.$queryRaw`SELECT id FROM visits WHERE id = ${visitId}::uuid FOR UPDATE`;
  const { visit, facts, residents, visitorEmail } = await factsAndRecipients(tx, visitId);
  const steps = dueSteps(visit, now, times);
  if (!steps.length || !visit.expectedExitAt) return null;
  const limit = visit.expectedExitAt.getTime();
  let taskId: string | null = null;

  for (const step of steps) {
    if (step === "overstay") {
      await transitionVisit(tx, visitId, "overstay", { at: visit.expectedExitAt });
      if (visitorEmail) {
        await queueEmail(tx, {
          kind: "overstay",
          to: visitorEmail,
          key: `visit:${visitId}:overstay:visitor`,
          message: templates.overstayVisitor(facts),
        });
      }
      for (const r of residents) {
        await queueEmail(tx, {
          kind: "overstay",
          to: r.email,
          key: `visit:${visitId}:overstay:resident:${r.id}`,
          message: templates.overstayResident(facts),
        });
      }
    }
    if (step === "reminder") {
      for (const r of residents) {
        await queueEmail(tx, {
          kind: "overstay_reminder",
          to: r.email,
          key: `visit:${visitId}:overstay_reminder:resident:${r.id}`,
          message: templates.reminderResident(facts),
        });
      }
    }
    if (step === "escalate") {
      await transitionVisit(tx, visitId, "escalate", {
        at: new Date(limit + times.escalationMinutes * 60_000),
      });
      const task = await tx.escalationTask.upsert({
        where: { visitId },
        create: { visitId },
        update: {},
      });
      taskId = task.id;
    }
  }
  return { visitId, flatId: visit.flatId, steps, escalationTaskId: taskId };
}

/** One tick of the ladder at `now`. Returns what changed, for real-time announcements. */
export async function runLadder(
  now = new Date(),
  times: LadderTimes = defaultTimes(),
): Promise<LadderOutcome[]> {
  const candidates = await prisma.visit.findMany({
    where: { status: { in: ["inside", "overstayed"] }, expectedExitAt: { lte: now } },
    select: { id: true },
    orderBy: { expectedExitAt: "asc" },
  });
  const outcomes: LadderOutcome[] = [];
  for (const { id } of candidates) {
    const outcome = await withTx((tx) => applySteps(tx, id, now, times));
    if (outcome) outcomes.push(outcome);
  }
  return outcomes;
}
