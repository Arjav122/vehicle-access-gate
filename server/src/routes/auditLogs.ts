// Audit log: read-only list of admin changes.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { defineRoute, pageOf, PageQuery, roles } from "../openapi.js";

export const auditLogsRouter = Router();

const AuditLog = z
  .object({
    id: z.uuid(),
    actor: z.object({ id: z.uuid(), fullName: z.string(), email: z.string() }).nullable(),
    action: z.string().describe('e.g. "vehicle.update"'),
    entityType: z.string(),
    entityId: z.string().nullable(),
    changes: z
      .record(z.string(), z.tuple([z.unknown(), z.unknown()]))
      .nullable()
      .describe('{ field: [before, after] }, e.g. { "colour": ["White", "Grey"] }'),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "AuditLog" });

const AuditQuery = PageQuery.extend({
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  actorId: z.uuid().optional(),
  action: z.string().max(60).optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  until: z.iso.datetime({ offset: true }).optional(),
});

defineRoute(
  auditLogsRouter,
  {
    method: "get",
    path: "/audit-logs",
    tag: "Audit log",
    summary: "List audit log entries, newest first",
    access: roles("admin"),
    query: AuditQuery,
    responses: { 200: { description: "Entries", schema: pageOf(AuditLog) } },
  },
  async ({ query, res }) => {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.since || query.until
        ? {
            createdAt: {
              ...(query.since ? { gte: new Date(query.since) } : {}),
              ...(query.until ? { lt: new Date(query.until) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, fullName: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        actor: r.actor,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        changes: r.changes,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  },
);
