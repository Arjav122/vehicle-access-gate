// Scheduled jobs (brief §10.6), run inside the server process when RUN_JOBS=true.
// Each job is idempotent at the database level, so a restart or a double run is harmless.
// Phase 4 adds approvals.expire; Phase 5 adds escalation, notifications, reconciliation, retention.
import cron from "node-cron";
import { logger } from "./middleware.js";
import { publish } from "./realtime.js";
import { loadVisit } from "./routes/visits.js";
import { expireApprovals } from "./services/approvals.js";

/** Expire overdue approvals and tell staff + the flat that the guard decides now. */
export async function runApprovalExpiry(now = new Date()): Promise<number> {
  const expired = await expireApprovals(now);
  for (const approval of expired) {
    const visit = await loadVisit(approval.visitId);
    await publish("approval.timed_out", visit, { staff: true, flatId: visit.flatId });
  }
  return expired.length;
}

function guarded(name: string, job: () => Promise<unknown>): () => Promise<void> {
  return async () => {
    try {
      await job();
    } catch (err) {
      logger.error({ err, job: name }, "scheduled job failed");
    }
  };
}

export function startJobs(): { stop: () => void } {
  const tasks = [
    cron.schedule(
      "*/15 * * * * *",
      guarded("approvals.expire", () => runApprovalExpiry()),
      {
        name: "approvals.expire",
        noOverlap: true,
      },
    ),
  ];
  logger.info("scheduled jobs started: approvals.expire (every 15 s)");
  return {
    stop: () => {
      for (const task of tasks) void task.stop();
    },
  };
}
