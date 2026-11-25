// Daily retention (brief §3, §10.6): keep personal data only as long as needed.
//   - visitors: name, phone and email are erased after VISITOR_RETENTION_DAYS (settings), unless
//     a visit of theirs is still open; the visit history stays, anonymised
//   - notifications: recipient and body are redacted after the same period (sent/failed only)
//   - snapshots: camera images older than the period are deleted
import { prisma } from "../db.js";
import { deleteSnapshot } from "./storage.js";
import { effectiveSettings } from "./visits.js";

export interface RetentionResult {
  visitorsPurged: number;
  notificationsRedacted: number;
  snapshotsDeleted: number;
}

export async function runRetention(now = new Date()): Promise<RetentionResult> {
  const { visitorRetentionDays } = await effectiveSettings(prisma);
  const cutoff = new Date(now.getTime() - visitorRetentionDays * 86_400_000);

  const visitorsPurged = await prisma.$executeRaw`
    UPDATE visitors v SET full_name = NULL, phone = NULL, email = NULL, purged_at = ${now}
    WHERE v.purged_at IS NULL AND v.created_at < ${cutoff}
      AND NOT EXISTS (
        SELECT 1 FROM visits x WHERE x.visitor_id = v.id
          AND x.status IN ('pending_approval', 'approved', 'inside', 'overstayed', 'escalated'))`;

  const notificationsRedacted = await prisma.$executeRaw`
    UPDATE notifications SET recipient = '[redacted]', body_text = '[redacted]', body_html = NULL
    WHERE created_at < ${cutoff} AND status <> 'pending' AND recipient <> '[redacted]'`;

  let snapshotsDeleted = 0;
  for (;;) {
    const batch = await prisma.gateEvent.findMany({
      where: { snapshotKey: { not: null }, capturedAt: { lt: cutoff } },
      select: { id: true, snapshotKey: true },
      take: 200,
    });
    if (!batch.length) break;
    for (const e of batch) {
      if (e.snapshotKey) await deleteSnapshot(e.snapshotKey);
    }
    await prisma.gateEvent.updateMany({
      where: { id: { in: batch.map((e) => e.id) } },
      data: { snapshotKey: null },
    });
    snapshotsDeleted += batch.length;
  }

  return { visitorsPurged, notificationsRedacted, snapshotsDeleted };
}
