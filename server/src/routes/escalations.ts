// Escalation tasks: "call the resident" for visitors far past their time limit. Guards see the
// residents' FULL phone numbers here (they have to dial them) and record the outcome once.
// An exit closes an open task automatically (outcome vehicle_left).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { EscalationOutcome, EscalationStatus } from "../../generated/prisma/enums.js";
import { currentUser, HttpError, notFound } from "../middleware.js";
import { defineRoute, IdParams, pageOf, PageQuery, roles } from "../openapi.js";
import { publish } from "../realtime.js";
import { flatLabel } from "./flats.js";

export const escalationsRouter = Router();

const Task = z
  .object({
    id: z.uuid(),
    status: z.enum(EscalationStatus),
    outcome: z.enum(EscalationOutcome).nullable(),
    notes: z.string().nullable(),
    visit: z.object({
      id: z.uuid(),
      flatLabel: z.string(),
      plate: z.string().nullable(),
      visitorName: z.string().nullable(),
      category: z.string(),
      expectedExitAt: z.iso.datetime().nullable(),
    }),
    residents: z
      .array(
        z.object({
          fullName: z.string(),
          phone: z.string().nullable(),
          isPrimaryContact: z.boolean(),
        }),
      )
      .describe("Full phone numbers: the guard must call"),
    createdAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "EscalationTask" });

const include = {
  visit: {
    include: {
      visitor: true,
      flat: {
        include: { residents: { where: { user: { isActive: true } }, include: { user: true } } },
      },
    },
  },
} as const;
type Row = Prisma.EscalationTaskGetPayload<{ include: typeof include }>;

export const toTask = (t: Row): z.input<typeof Task> => ({
  id: t.id,
  status: t.status,
  outcome: t.outcome,
  notes: t.notes,
  visit: {
    id: t.visit.id,
    flatLabel: flatLabel(t.visit.flat),
    plate: t.visit.plateNormalized,
    visitorName: t.visit.visitor?.fullName ?? null,
    category: t.visit.category,
    expectedExitAt: t.visit.expectedExitAt?.toISOString() ?? null,
  },
  residents: t.visit.flat.residents
    .map((r) => ({
      fullName: r.user.fullName,
      phone: r.user.phone,
      isPrimaryContact: r.isPrimaryContact,
    }))
    .sort((a, b) => Number(b.isPrimaryContact) - Number(a.isPrimaryContact)),
  createdAt: t.createdAt.toISOString(),
  resolvedAt: t.resolvedAt?.toISOString() ?? null,
});

export async function loadTask(id: string) {
  return toTask(await prisma.escalationTask.findUniqueOrThrow({ where: { id }, include }));
}

defineRoute(
  escalationsRouter,
  {
    method: "get",
    path: "/escalations",
    tag: "Escalations",
    summary: "Call-the-resident tasks (open first)",
    access: roles("admin", "guard"),
    query: PageQuery.extend({ status: z.enum(EscalationStatus).optional() }),
    responses: { 200: { description: "Tasks", schema: pageOf(Task) } },
  },
  async ({ query, res }) => {
    const where: Prisma.EscalationTaskWhereInput = query.status ? { status: query.status } : {};
    const [rows, total] = await Promise.all([
      prisma.escalationTask.findMany({
        where,
        include,
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        take: query.limit,
        skip: query.offset,
      }),
      prisma.escalationTask.count({ where }),
    ]);
    res.json({ items: rows.map(toTask), total, limit: query.limit, offset: query.offset });
  },
);

defineRoute(
  escalationsRouter,
  {
    method: "post",
    path: "/escalations/:id/resolve",
    tag: "Escalations",
    summary: "Record the outcome of the call (once)",
    access: roles("admin", "guard"),
    params: IdParams,
    body: z.strictObject({
      outcome: z.enum(["reached", "not_reached"]),
      notes: z.string().trim().max(500).optional(),
    }),
    responses: {
      200: { description: "Resolved", schema: Task },
      404: { description: "Not found" },
      409: { description: "Already resolved" },
    },
  },
  async ({ params, body, res }) => {
    const userId = currentUser(res).id;
    const updated = await prisma.escalationTask.updateMany({
      where: { id: params.id, status: "open" },
      data: {
        status: "resolved",
        outcome: body.outcome,
        notes: body.notes ?? null,
        resolvedAt: new Date(),
        resolvedById: userId,
      },
    });
    if (updated.count === 0) {
      const exists = await prisma.escalationTask.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!exists) throw notFound("Task not found");
      throw new HttpError(409, "This task is already resolved");
    }
    const task = await loadTask(params.id);
    await publish("escalation.resolved", task, { staff: true });
    res.json(task);
  },
);
