// Scheduled jobs (brief §10.6), run inside the server process when RUN_JOBS=true.
// Every job is idempotent at the database level, so a restart, an overlap or a double run is
// harmless. Times of day are India time.
//
//   approvals.expire        every 15 s   hand unanswered approvals to the guard
//   escalation.tick         every minute overstay → reminder → call-the-resident task
//   notifications.dispatch  every minute send due emails, retry with backoff
//   reconciliation.nightly  03:00 IST    find records that don't add up
//   retention.daily         03:30 IST    erase old visitor data, redact old emails, delete old snapshots
//   (demo.nightlyReset arrives with demo mode in Phase 7.)
import cron from "node-cron";
import { logger } from "./middleware.js";
import { publish } from "./realtime.js";
import { loadTask } from "./routes/escalations.js";
import { loadVisit } from "./routes/visits.js";
import { expireApprovals } from "./services/approvals.js";
import { runLadder } from "./services/escalation.js";
import { dispatchDue, type Mailer, smtpMailer } from "./services/notifications.js";
import { runReconciliation } from "./services/reconciliation.js";
import { runRetention } from "./services/retention.js";

/** Expire overdue approvals and tell staff + the flat that the guard decides now. */
export async function runApprovalExpiry(now = new Date()): Promise<number> {
  const expired = await expireApprovals(now);
  for (const approval of expired) {
    const visit = await loadVisit(approval.visitId);
    await publish("approval.timed_out", visit, { staff: true, flatId: visit.flatId });
  }
  return expired.length;
}

/** One ladder tick, then real-time news for every visit that moved and every new task. */
export async function runEscalationTick(now = new Date()): Promise<number> {
  const outcomes = await runLadder(now);
  for (const o of outcomes) {
    const visit = await loadVisit(o.visitId);
    await publish("visit.updated", visit, { staff: true, flatId: o.flatId });
    if (o.escalationTaskId) {
      await publish("escalation.created", await loadTask(o.escalationTaskId), { staff: true });
    }
  }
  return outcomes.length;
}

function guarded(name: string, job: () => Promise<unknown>): () => Promise<void> {
  return async () => {
    try {
      const result = await job();
      logger.debug({ job: name, result }, "scheduled job done");
    } catch (err) {
      logger.error({ err, job: name }, "scheduled job failed");
    }
  };
}

export function startJobs(mailer: Mailer = smtpMailer()): { stop: () => void } {
  const opts = (name: string) => ({ name, timezone: "Asia/Kolkata", noOverlap: true });
  const tasks = [
    cron.schedule(
      "*/15 * * * * *",
      guarded("approvals.expire", () => runApprovalExpiry()),
      opts("approvals.expire"),
    ),
    cron.schedule(
      "0 * * * * *",
      guarded("escalation.tick", () => runEscalationTick()),
      opts("escalation.tick"),
    ),
    cron.schedule(
      "30 * * * * *",
      guarded("notifications.dispatch", () => dispatchDue(mailer)),
      opts("notifications.dispatch"),
    ),
    cron.schedule(
      "0 0 3 * * *",
      guarded("reconciliation.nightly", () => runReconciliation()),
      opts("reconciliation.nightly"),
    ),
    cron.schedule(
      "0 30 3 * * *",
      guarded("retention.daily", () => runRetention()),
      opts("retention.daily"),
    ),
  ];
  logger.info(
    "scheduled jobs started: approvals.expire, escalation.tick, notifications.dispatch, reconciliation.nightly, retention.daily",
  );
  return {
    stop: () => {
      for (const task of tasks) void task.stop();
    },
  };
}
