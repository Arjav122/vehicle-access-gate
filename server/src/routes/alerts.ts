// Alerts (watchlist hits) for the guard console. Acknowledging is idempotent.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AlertKind, AlertSeverity } from "../../generated/prisma/enums.js";
import { currentUser, notFound } from "../middleware.js";
import { defineRoute, IdParams, pageOf, PageQuery, queryBool, roles } from "../openapi.js";

export const alertsRouter = Router();

const Alert = z
  .object({
    id: z.uuid(),
    gateEventId: z.uuid(),
    kind: z.enum(AlertKind),
    severity: z.enum(AlertSeverity),
    message: z.string(),
    plate: z.string(),
    acknowledgedAt: z.iso.datetime().nullable(),
    acknowledgedBy: z.object({ id: z.uuid(), fullName: z.string() }).nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "Alert" });

const include = {
  gateEvent: { select: { plateNormalized: true } },
  acknowledgedBy: { select: { id: true, fullName: true } },
} as const;
type Row = Prisma.AlertGetPayload<{ include: typeof include }>;

const toAlert = (a: Row): z.input<typeof Alert> => ({
  id: a.id,
  gateEventId: a.gateEventId,
  kind: a.kind,
  severity: a.severity,
  message: a.message,
  plate: a.gateEvent.plateNormalized,
  acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
  acknowledgedBy: a.acknowledgedBy,
  createdAt: a.createdAt.toISOString(),
});

defineRoute(
  alertsRouter,
  {
    method: "get",
    path: "/alerts",
    tag: "Alerts",
    summary: "List alerts, newest first",
    access: roles("admin", "guard"),
    query: PageQuery.extend({ acknowledged: queryBool.optional() }),
    responses: { 200: { description: "Alerts", schema: pageOf(Alert) } },
  },
  async ({ query, res }) => {
    const where: Prisma.AlertWhereInput =
      query.acknowledged === undefined
        ? {}
        : { acknowledgedAt: query.acknowledged ? { not: null } : null };
    const [rows, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        include,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.alert.count({ where }),
    ]);
    res.json({ items: rows.map(toAlert), total, limit: query.limit, offset: query.offset });
  },
);

defineRoute(
  alertsRouter,
  {
    method: "post",
    path: "/alerts/:id/acknowledge",
    tag: "Alerts",
    summary: "Acknowledge an alert (doing it twice is fine)",
    access: roles("admin", "guard"),
    params: IdParams,
    responses: {
      200: { description: "Acknowledged", schema: Alert },
      404: { description: "Not found" },
    },
  },
  async ({ params, res }) => {
    const userId = currentUser(res).id;
    // Only the first acknowledgement is recorded; later ones change nothing.
    await prisma.alert.updateMany({
      where: { id: params.id, acknowledgedAt: null },
      data: { acknowledgedAt: new Date(), acknowledgedById: userId },
    });
    const alert = await prisma.alert.findUnique({ where: { id: params.id }, include });
    if (!alert) throw notFound("Alert not found");
    res.json(toAlert(alert));
  },
);
