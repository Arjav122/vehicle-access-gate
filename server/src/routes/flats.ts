// Flats: read by staff, managed by admins. Shown as "B-402".
import { Router } from "express";
import { z } from "zod";
import { prisma, withTx } from "../db.js";
import type { Flat as FlatRow, Prisma } from "../../generated/prisma/client.js";
import { currentUser, notFound } from "../middleware.js";
import { defineRoute, IdParams, pageOf, PageQuery, roles } from "../openapi.js";
import { recordAudit } from "../services/audit.js";

export const flatsRouter = Router();

export const flatLabel = (f: { block: string; number: string }) => `${f.block}-${f.number}`;

const Flat = z
  .object({
    id: z.uuid(),
    block: z.string(),
    number: z.string(),
    floor: z.number().int(),
    label: z.string().describe('Display form, e.g. "B-402"'),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Flat" });

const toFlat = (f: FlatRow): z.input<typeof Flat> => ({
  id: f.id,
  block: f.block,
  number: f.number,
  floor: f.floor,
  label: flatLabel(f),
  createdAt: f.createdAt.toISOString(),
  updatedAt: f.updatedAt.toISOString(),
});

const block = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,3}$/, "Block is 1–3 letters, e.g. B");
const number = z
  .string()
  .trim()
  .regex(/^\d{1,5}$/, "Flat number is digits only, e.g. 402");
const floor = z.number().int().min(-3).max(200);

const FlatCreate = z.strictObject({ block, number, floor });
const FlatUpdate = z
  .strictObject({ block: block.optional(), number: number.optional(), floor: floor.optional() })
  .refine((v) => Object.keys(v).length > 0, "Send at least one field to change");

const FlatQuery = PageQuery.extend({
  q: z.string().trim().max(20).optional().describe('Search "402" or "B-402"'),
  block: block.optional(),
});

/** "B-402" / "b402" → exact flat; "402" → any block. */
function flatSearch(q: string): Prisma.FlatWhereInput {
  const m = /^([A-Za-z]{1,3})\s*-?\s*(\d{1,5})$/.exec(q);
  if (m?.[1] && m[2]) return { block: m[1].toUpperCase(), number: m[2] };
  return { number: { contains: q } };
}

defineRoute(
  flatsRouter,
  {
    method: "get",
    path: "/flats",
    tag: "Flats",
    summary: "List flats",
    access: roles("admin", "guard"),
    query: FlatQuery,
    responses: { 200: { description: "Flats", schema: pageOf(Flat) } },
  },
  async ({ query, res }) => {
    const where: Prisma.FlatWhereInput = {
      ...(query.q ? flatSearch(query.q) : {}),
      ...(query.block ? { block: query.block } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.flat.findMany({
        where,
        orderBy: [{ block: "asc" }, { floor: "asc" }, { number: "asc" }],
        take: query.limit,
        skip: query.offset,
      }),
      prisma.flat.count({ where }),
    ]);
    res.json({ items: items.map(toFlat), total, limit: query.limit, offset: query.offset });
  },
);

defineRoute(
  flatsRouter,
  {
    method: "get",
    path: "/flats/:id",
    tag: "Flats",
    summary: "Get a flat",
    access: roles("admin", "guard"),
    params: IdParams,
    responses: { 200: { description: "Flat", schema: Flat }, 404: { description: "Not found" } },
  },
  async ({ params, res }) => {
    const flat = await prisma.flat.findUnique({ where: { id: params.id } });
    if (!flat) throw notFound("Flat not found");
    res.json(toFlat(flat));
  },
);

defineRoute(
  flatsRouter,
  {
    method: "post",
    path: "/flats",
    tag: "Flats",
    summary: "Add a flat",
    access: roles("admin"),
    body: FlatCreate,
    responses: {
      201: { description: "Created", schema: Flat },
      409: { description: "Already exists" },
    },
  },
  async ({ body, res }) => {
    const actorId = currentUser(res).id;
    const flat = await withTx(async (tx) => {
      const created = await tx.flat.create({ data: body });
      await recordAudit(tx, {
        actorId,
        action: "flat.create",
        entityType: "flat",
        entityId: created.id,
        after: created,
      });
      return created;
    });
    res.status(201).json(toFlat(flat));
  },
);

defineRoute(
  flatsRouter,
  {
    method: "patch",
    path: "/flats/:id",
    tag: "Flats",
    summary: "Change a flat",
    access: roles("admin"),
    params: IdParams,
    body: FlatUpdate,
    responses: {
      200: { description: "Updated", schema: Flat },
      404: { description: "Not found" },
      409: { description: "Conflict" },
    },
  },
  async ({ params, body, res }) => {
    const actorId = currentUser(res).id;
    const flat = await withTx(async (tx) => {
      const before = await tx.flat.findUnique({ where: { id: params.id } });
      if (!before) throw notFound("Flat not found");
      const after = await tx.flat.update({ where: { id: params.id }, data: body });
      await recordAudit(tx, {
        actorId,
        action: "flat.update",
        entityType: "flat",
        entityId: after.id,
        before,
        after,
      });
      return after;
    });
    res.json(toFlat(flat));
  },
);

defineRoute(
  flatsRouter,
  {
    method: "delete",
    path: "/flats/:id",
    tag: "Flats",
    summary: "Delete a flat (only if nothing refers to it)",
    access: roles("admin"),
    params: IdParams,
    responses: {
      204: { description: "Deleted" },
      404: { description: "Not found" },
      409: { description: "Still has residents, vehicles or visits" },
    },
  },
  async ({ params, res }) => {
    const actorId = currentUser(res).id;
    await withTx(async (tx) => {
      const before = await tx.flat.findUnique({ where: { id: params.id } });
      if (!before) throw notFound("Flat not found");
      await tx.flat.delete({ where: { id: params.id } });
      await recordAudit(tx, {
        actorId,
        action: "flat.delete",
        entityType: "flat",
        entityId: before.id,
        before,
      });
    });
    res.status(204).end();
  },
);
