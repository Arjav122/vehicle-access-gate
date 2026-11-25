// Watchlist: plates that must raise a high-priority alert at the gate (Phase 2 raises it).
import { Router } from "express";
import { z } from "zod";
import { prisma, withTx } from "../db.js";
import type { Prisma, WatchlistEntry as EntryRow } from "../../generated/prisma/client.js";
import { currentUser, notFound } from "../middleware.js";
import { defineRoute, IdParams, pageOf, PageQuery, queryBool, roles } from "../openapi.js";
import { recordAudit } from "../services/audit.js";
import { cleanPlate } from "../services/plates.js";
import { plateField } from "./vehicles.js";

export const watchlistRouter = Router();

const WatchlistEntry = z
  .object({
    id: z.uuid(),
    plate: z.string(),
    plateRaw: z.string(),
    reason: z.string(),
    isActive: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "WatchlistEntry" });

const toEntry = (w: EntryRow): z.input<typeof WatchlistEntry> => ({
  id: w.id,
  plate: w.plateNormalized,
  plateRaw: w.plateRaw,
  reason: w.reason,
  isActive: w.isActive,
  createdAt: w.createdAt.toISOString(),
  updatedAt: w.updatedAt.toISOString(),
});

const reason = z.string().trim().min(1).max(300);

defineRoute(
  watchlistRouter,
  {
    method: "get",
    path: "/watchlist",
    tag: "Watchlist",
    summary: "List watchlist plates",
    access: roles("admin"),
    query: PageQuery.extend({
      q: z.string().trim().max(32).optional(),
      isActive: queryBool.optional(),
    }),
    responses: { 200: { description: "Entries", schema: pageOf(WatchlistEntry) } },
  },
  async ({ query, res }) => {
    const where: Prisma.WatchlistEntryWhereInput = {
      ...(query.q ? { plateNormalized: { contains: cleanPlate(query.q) } } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    };
    const [rows, total] = await Promise.all([
      prisma.watchlistEntry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.watchlistEntry.count({ where }),
    ]);
    res.json({ items: rows.map(toEntry), total, limit: query.limit, offset: query.offset });
  },
);

defineRoute(
  watchlistRouter,
  {
    method: "get",
    path: "/watchlist/:id",
    tag: "Watchlist",
    summary: "Get a watchlist entry",
    access: roles("admin"),
    params: IdParams,
    responses: {
      200: { description: "Entry", schema: WatchlistEntry },
      404: { description: "Not found" },
    },
  },
  async ({ params, res }) => {
    const entry = await prisma.watchlistEntry.findUnique({ where: { id: params.id } });
    if (!entry) throw notFound("Watchlist entry not found");
    res.json(toEntry(entry));
  },
);

defineRoute(
  watchlistRouter,
  {
    method: "post",
    path: "/watchlist",
    tag: "Watchlist",
    summary: "Add a plate to the watchlist",
    access: roles("admin"),
    body: z.strictObject({ plate: plateField, reason }),
    responses: {
      201: { description: "Created", schema: WatchlistEntry },
      409: { description: "Already on the watchlist" },
    },
  },
  async ({ body, res }) => {
    const actorId = currentUser(res).id;
    const entry = await withTx(async (tx) => {
      const created = await tx.watchlistEntry.create({
        data: {
          plateRaw: body.plate.raw,
          plateNormalized: body.plate.normalized,
          reason: body.reason,
        },
      });
      await recordAudit(tx, {
        actorId,
        action: "watchlist.create",
        entityType: "watchlist",
        entityId: created.id,
        after: created,
      });
      return created;
    });
    res.status(201).json(toEntry(entry));
  },
);

defineRoute(
  watchlistRouter,
  {
    method: "patch",
    path: "/watchlist/:id",
    tag: "Watchlist",
    summary: "Change a watchlist entry",
    access: roles("admin"),
    params: IdParams,
    body: z
      .strictObject({
        plate: plateField.optional(),
        reason: reason.optional(),
        isActive: z.boolean().optional(),
      })
      .refine((v) => Object.keys(v).length > 0, "Send at least one field to change"),
    responses: {
      200: { description: "Updated", schema: WatchlistEntry },
      404: { description: "Not found" },
      409: { description: "Already on the watchlist" },
    },
  },
  async ({ params, body, res }) => {
    const actorId = currentUser(res).id;
    const entry = await withTx(async (tx) => {
      const before = await tx.watchlistEntry.findUnique({ where: { id: params.id } });
      if (!before) throw notFound("Watchlist entry not found");
      const after = await tx.watchlistEntry.update({
        where: { id: params.id },
        data: {
          ...(body.plate !== undefined
            ? { plateRaw: body.plate.raw, plateNormalized: body.plate.normalized }
            : {}),
          ...(body.reason !== undefined ? { reason: body.reason } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });
      await recordAudit(tx, {
        actorId,
        action: "watchlist.update",
        entityType: "watchlist",
        entityId: after.id,
        before,
        after,
      });
      return after;
    });
    res.json(toEntry(entry));
  },
);

defineRoute(
  watchlistRouter,
  {
    method: "delete",
    path: "/watchlist/:id",
    tag: "Watchlist",
    summary: "Remove a plate from the watchlist",
    access: roles("admin"),
    params: IdParams,
    responses: { 204: { description: "Deleted" }, 404: { description: "Not found" } },
  },
  async ({ params, res }) => {
    const actorId = currentUser(res).id;
    await withTx(async (tx) => {
      const before = await tx.watchlistEntry.findUnique({ where: { id: params.id } });
      if (!before) throw notFound("Watchlist entry not found");
      await tx.watchlistEntry.delete({ where: { id: params.id } });
      await recordAudit(tx, {
        actorId,
        action: "watchlist.delete",
        entityType: "watchlist",
        entityId: before.id,
        before,
      });
    });
    res.status(204).end();
  },
);
