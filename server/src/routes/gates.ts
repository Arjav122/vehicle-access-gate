// Gates (e.g. "Main gate"). Each gate has camera devices for its entry and exit lanes.
import { Router } from "express";
import { z } from "zod";
import { prisma, withTx } from "../db.js";
import type { Gate as GateRow, Prisma } from "../../generated/prisma/client.js";
import { currentUser, notFound } from "../middleware.js";
import { defineRoute, IdParams, pageOf, PageQuery, queryBool, roles } from "../openapi.js";
import { recordAudit } from "../services/audit.js";

export const gatesRouter = Router();

const Gate = z
  .object({
    id: z.uuid(),
    name: z.string(),
    isActive: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Gate" });

const toGate = (g: GateRow): z.input<typeof Gate> => ({
  id: g.id,
  name: g.name,
  isActive: g.isActive,
  createdAt: g.createdAt.toISOString(),
  updatedAt: g.updatedAt.toISOString(),
});

const name = z.string().trim().min(1).max(60);

defineRoute(
  gatesRouter,
  {
    method: "get",
    path: "/gates",
    tag: "Gates",
    summary: "List gates",
    access: roles("admin"),
    query: PageQuery.extend({ isActive: queryBool.optional() }),
    responses: { 200: { description: "Gates", schema: pageOf(Gate) } },
  },
  async ({ query, res }) => {
    const where: Prisma.GateWhereInput =
      query.isActive === undefined ? {} : { isActive: query.isActive };
    const [rows, total] = await Promise.all([
      prisma.gate.findMany({
        where,
        orderBy: { name: "asc" },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.gate.count({ where }),
    ]);
    res.json({ items: rows.map(toGate), total, limit: query.limit, offset: query.offset });
  },
);

defineRoute(
  gatesRouter,
  {
    method: "get",
    path: "/gates/:id",
    tag: "Gates",
    summary: "Get a gate",
    access: roles("admin"),
    params: IdParams,
    responses: { 200: { description: "Gate", schema: Gate }, 404: { description: "Not found" } },
  },
  async ({ params, res }) => {
    const gate = await prisma.gate.findUnique({ where: { id: params.id } });
    if (!gate) throw notFound("Gate not found");
    res.json(toGate(gate));
  },
);

defineRoute(
  gatesRouter,
  {
    method: "post",
    path: "/gates",
    tag: "Gates",
    summary: "Add a gate",
    access: roles("admin"),
    body: z.strictObject({ name }),
    responses: {
      201: { description: "Created", schema: Gate },
      409: { description: "Name taken" },
    },
  },
  async ({ body, res }) => {
    const actorId = currentUser(res).id;
    const gate = await withTx(async (tx) => {
      const created = await tx.gate.create({ data: { name: body.name } });
      await recordAudit(tx, {
        actorId,
        action: "gate.create",
        entityType: "gate",
        entityId: created.id,
        after: created,
      });
      return created;
    });
    res.status(201).json(toGate(gate));
  },
);

defineRoute(
  gatesRouter,
  {
    method: "patch",
    path: "/gates/:id",
    tag: "Gates",
    summary: "Rename or (de)activate a gate",
    access: roles("admin"),
    params: IdParams,
    body: z
      .strictObject({ name: name.optional(), isActive: z.boolean().optional() })
      .refine((v) => Object.keys(v).length > 0, "Send at least one field to change"),
    responses: {
      200: { description: "Updated", schema: Gate },
      404: { description: "Not found" },
      409: { description: "Name taken" },
    },
  },
  async ({ params, body, res }) => {
    const actorId = currentUser(res).id;
    const gate = await withTx(async (tx) => {
      const before = await tx.gate.findUnique({ where: { id: params.id } });
      if (!before) throw notFound("Gate not found");
      const after = await tx.gate.update({ where: { id: params.id }, data: body });
      await recordAudit(tx, {
        actorId,
        action: "gate.update",
        entityType: "gate",
        entityId: after.id,
        before,
        after,
      });
      return after;
    });
    res.json(toGate(gate));
  },
);

defineRoute(
  gatesRouter,
  {
    method: "delete",
    path: "/gates/:id",
    tag: "Gates",
    summary: "Delete a gate (only if it has no devices or events)",
    access: roles("admin"),
    params: IdParams,
    responses: {
      204: { description: "Deleted" },
      404: { description: "Not found" },
      409: { description: "Still has devices or events" },
    },
  },
  async ({ params, res }) => {
    const actorId = currentUser(res).id;
    await withTx(async (tx) => {
      const before = await tx.gate.findUnique({ where: { id: params.id } });
      if (!before) throw notFound("Gate not found");
      await tx.gate.delete({ where: { id: params.id } });
      await recordAudit(tx, {
        actorId,
        action: "gate.delete",
        entityType: "gate",
        entityId: before.id,
        before,
      });
    });
    res.status(204).end();
  },
);
