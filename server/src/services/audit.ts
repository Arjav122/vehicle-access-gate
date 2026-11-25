// Audit log: one row per admin create / update / delete, with what changed.
// changes = { field: [before, after] }, e.g. { "colour": ["White", "Grey"] }.
// Secrets (password, key and code hashes) are never written; a password change is noted only.
import type { Tx } from "../db.js";
import { Prisma } from "../../generated/prisma/client.js";

const HIDDEN = new Set(["passwordHash", "apiKeyHash", "codeHash"]);
const SKIPPED = new Set(["createdAt", "updatedAt"]);

type Snapshot = Record<string, unknown> | null;
type Change = [unknown, unknown];

function plain(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : (value ?? null);
}

/** Fields that differ between two snapshots (null = did not exist). */
export function diff(before: Snapshot, after: Snapshot): Record<string, Change> {
  const changes: Record<string, Change> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (SKIPPED.has(k)) continue;
    const a = plain(before?.[k]);
    const b = plain(after?.[k]);
    if (HIDDEN.has(k)) {
      if (before && after && a !== b)
        changes[k === "passwordHash" ? "password" : k] = ["(hidden)", "(changed)"];
      continue;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[k] = [a, b];
  }
  return changes;
}

export interface AuditEntry {
  actorId: string;
  /** e.g. "vehicle.update" */
  action: string;
  entityType: string;
  entityId: string;
  before?: Snapshot;
  after?: Snapshot;
}

/** Write one audit row inside the caller's transaction, so it commits with the change. */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  const changes = diff(entry.before ?? null, entry.after ?? null);
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      changes: Object.keys(changes).length ? (changes as Prisma.InputJsonObject) : Prisma.JsonNull,
    },
  });
}
