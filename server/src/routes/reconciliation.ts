// Reconciliation findings ("Checks" in the admin dashboard) and the email delivery log.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { NotificationStatus, ReconciliationKind } from "../../generated/prisma/enums.js";
import { currentUser, HttpError, notFound } from "../middleware.js";
import { defineRoute, IdParams, pageOf, PageQuery, queryBool, roles } from "../openapi.js";

export const reconciliationRouter = Router();

const Flag = z
  .object({
    id: z.uuid(),
    kind: z.enum(ReconciliationKind),
    details: z.string().nullable(),
    gateEventId: z.uuid().nullable(),
    visitId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "ReconciliationFlag" });

defineRoute(
  reconciliationRouter,
  {
    method: "get",
    path: "/reconciliation",
    tag: "Reconciliation",
    summary: "Nightly findings that need an admin's eye",
    access: roles("admin"),
    query: PageQuery.extend({
      resolved: queryBool.optional(),
      kind: z.enum(ReconciliationKind).optional(),
    }),
    responses: { 200: { description: "Findings", schema: pageOf(Flag) } },
  },
  async ({ query, res }) => {
    const where: Prisma.ReconciliationFlagWhereInput = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.resolved === undefined
        ? {}
        : { resolvedAt: query.resolved ? { not: null } : null }),
    };
    const [rows, total] = await Promise.all([
      prisma.reconciliationFlag.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.reconciliationFlag.count({ where }),
    ]);
    res.json({
      items: rows.map((f) => ({
        id: f.id,
        kind: f.kind,
        details: f.details,
        gateEventId: f.gateEventId,
        visitId: f.visitId,
        createdAt: f.createdAt.toISOString(),
        resolvedAt: f.resolvedAt?.toISOString() ?? null,
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  },
);

defineRoute(
  reconciliationRouter,
  {
    method: "post",
    path: "/reconciliation/:id/resolve",
    tag: "Reconciliation",
    summary: "Mark a finding as checked",
    access: roles("admin"),
    params: IdParams,
    responses: {
      204: { description: "Resolved" },
      404: { description: "Not found" },
      409: { description: "Already resolved" },
    },
  },
  async ({ params, res }) => {
    const updated = await prisma.reconciliationFlag.updateMany({
      where: { id: params.id, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedById: currentUser(res).id },
    });
    if (updated.count === 0) {
      if (!(await prisma.reconciliationFlag.findUnique({ where: { id: params.id } })))
        throw notFound("Finding not found");
      throw new HttpError(409, "Already resolved");
    }
    res.status(204).end();
  },
);

const Notification = z
  .object({
    id: z.uuid(),
    channel: z.string(),
    kind: z.string(),
    recipient: z.string(),
    subject: z.string().nullable(),
    status: z.enum(NotificationStatus),
    attempts: z.number().int(),
    nextAttemptAt: z.iso.datetime(),
    lastError: z.string().nullable(),
    sentAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "Notification" });

defineRoute(
  reconciliationRouter,
  {
    method: "get",
    path: "/notifications",
    tag: "Notifications",
    summary: "Email delivery log (newest first)",
    access: roles("admin"),
    query: PageQuery.extend({
      status: z.enum(NotificationStatus).optional(),
      kind: z.string().max(40).optional(),
    }),
    responses: { 200: { description: "Notifications", schema: pageOf(Notification) } },
  },
  async ({ query, res }) => {
    const where: Prisma.NotificationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.notification.count({ where }),
    ]);
    res.json({
      items: rows.map((n) => ({
        id: n.id,
        channel: n.channel,
        kind: n.kind,
        recipient: n.recipient,
        subject: n.subject,
        status: n.status,
        attempts: n.attempts,
        nextAttemptAt: n.nextAttemptAt.toISOString(),
        lastError: n.lastError,
        sentAt: n.sentAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  },
);
