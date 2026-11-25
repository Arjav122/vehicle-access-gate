// Guest passes: residents create and revoke them; staff list them and redeem codes at the gate.
import { Router } from "express";
import { z } from "zod";
import { prisma, withTx } from "../db.js";
import type { GuestPass as PassRow, Prisma } from "../../generated/prisma/client.js";
import { currentUser, HttpError, notFound } from "../middleware.js";
import { defineRoute, IdParams, pageOf, PageQuery, queryBool, roles } from "../openapi.js";
import { publish } from "../realtime.js";
import { admitWithPass, hashCode, newCode, passState, tidyCode } from "../services/guestPasses.js";
import { normalizePlate } from "../services/plates.js";
import { flatIdsOf } from "../services/visits.js";
import { loadVisit, Visit } from "./visits.js";

export const guestPassesRouter = Router();

const GuestPass = z
  .object({
    id: z.uuid(),
    flatId: z.uuid(),
    guestName: z.string().nullable(),
    plate: z.string().nullable(),
    hasCode: z.boolean(),
    validFrom: z.iso.datetime(),
    validUntil: z.iso.datetime(),
    maxUses: z.number().int(),
    useCount: z.number().int(),
    state: z.enum(["active", "not_yet_valid", "expired", "used_up", "revoked"]),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "GuestPass" });

const toPass = (p: PassRow, now = new Date()): z.input<typeof GuestPass> => ({
  id: p.id,
  flatId: p.flatId,
  guestName: p.guestName,
  plate: p.plateNormalized,
  hasCode: p.codeHash !== null,
  validFrom: p.validFrom.toISOString(),
  validUntil: p.validUntil.toISOString(),
  maxUses: p.maxUses,
  useCount: p.useCount,
  state: passState(p, now),
  createdAt: p.createdAt.toISOString(),
});

const CreateBody = z
  .strictObject({
    flatId: z.uuid(),
    guestName: z.string().trim().min(1).max(120).optional(),
    plate: z
      .string()
      .trim()
      .min(4)
      .max(32)
      .transform((raw, ctx) => {
        const plate = normalizePlate(raw);
        if (!plate) {
          ctx.addIssue({ code: "custom", message: "Not a valid Indian number plate" });
          return z.NEVER;
        }
        return plate;
      })
      .optional(),
    withCode: z.boolean().default(true).describe("Also issue a one-time code (shown only once)"),
    validFrom: z.iso.datetime({ offset: true }).optional().describe("Default: now"),
    validUntil: z.iso.datetime({ offset: true }),
    maxUses: z.number().int().min(1).max(50).default(1),
  })
  .refine((b) => b.plate !== undefined || b.withCode, "A pass needs a plate, a code, or both")
  .refine(
    (b) => new Date(b.validUntil) > new Date(b.validFrom ?? Date.now()),
    "validUntil must be after validFrom",
  );

defineRoute(
  guestPassesRouter,
  {
    method: "post",
    path: "/guest-passes",
    tag: "Guest passes",
    summary: "Create a guest pass for your flat (the code is returned once)",
    access: roles("resident"),
    body: CreateBody,
    responses: {
      201: {
        description: "Created",
        schema: GuestPass.extend({ code: z.string().nullable().describe("Shown only now") }),
      },
      404: { description: "Not your flat" },
    },
  },
  async ({ body, res }) => {
    const user = currentUser(res);
    if (!(await flatIdsOf(prisma, user.id)).includes(body.flatId)) throw notFound("Flat not found");
    const code = body.withCode ? newCode() : null;
    const pass = await prisma.guestPass.create({
      data: {
        flatId: body.flatId,
        createdById: user.id,
        guestName: body.guestName ?? null,
        plateNormalized: body.plate ?? null,
        codeHash: code ? hashCode(code) : null,
        validFrom: body.validFrom ? new Date(body.validFrom) : new Date(),
        validUntil: new Date(body.validUntil),
        maxUses: body.maxUses,
      },
    });
    res.status(201).json({ ...toPass(pass), code });
  },
);

defineRoute(
  guestPassesRouter,
  {
    method: "get",
    path: "/guest-passes",
    tag: "Guest passes",
    summary: "List guest passes (residents: their own flats)",
    access: roles("admin", "guard", "resident"),
    query: PageQuery.extend({
      active: queryBool.optional().describe("Only passes usable right now"),
    }),
    responses: { 200: { description: "Passes", schema: pageOf(GuestPass) } },
  },
  async ({ query, res }) => {
    const user = currentUser(res);
    const now = new Date();
    const where: Prisma.GuestPassWhereInput = {
      ...(user.role === "resident" ? { flatId: { in: await flatIdsOf(prisma, user.id) } } : {}),
      ...(query.active
        ? { revokedAt: null, validFrom: { lte: now }, validUntil: { gt: now } }
        : {}),
    };
    const rows = await prisma.guestPass.findMany({ where, orderBy: { createdAt: "desc" } });
    // "used up" can't be filtered in a plain where; filter in memory (lists are per flat, small).
    const usable = query.active ? rows.filter((p) => p.useCount < p.maxUses) : rows;
    const page = usable.slice(query.offset, query.offset + query.limit);
    res.json({
      items: page.map((p) => toPass(p, now)),
      total: usable.length,
      limit: query.limit,
      offset: query.offset,
    });
  },
);

defineRoute(
  guestPassesRouter,
  {
    method: "post",
    path: "/guest-passes/:id/revoke",
    tag: "Guest passes",
    summary: "Revoke your guest pass",
    access: roles("resident"),
    params: IdParams,
    responses: {
      200: { description: "Revoked", schema: GuestPass },
      404: { description: "Not found" },
    },
  },
  async ({ params, res }) => {
    const user = currentUser(res);
    const pass = await prisma.guestPass.findUnique({ where: { id: params.id } });
    if (!pass || !(await flatIdsOf(prisma, user.id)).includes(pass.flatId))
      throw notFound("Guest pass not found");
    const updated = pass.revokedAt
      ? pass
      : await prisma.guestPass.update({ where: { id: pass.id }, data: { revokedAt: new Date() } });
    res.json(toPass(updated));
  },
);

defineRoute(
  guestPassesRouter,
  {
    method: "post",
    path: "/guest-passes/redeem",
    tag: "Guest passes",
    summary: "Guard types a guest's code: the guest is let in (visit created inside)",
    access: roles("admin", "guard"),
    body: z.strictObject({
      code: z.string().trim().min(4).max(20),
      plate: z.string().trim().max(32).optional(),
    }),
    responses: {
      201: { description: "Let in", schema: Visit },
      404: { description: "No such code" },
      409: { description: "Pass expired, not yet valid, used up or revoked" },
    },
  },
  async ({ body, res }) => {
    const guardId = currentUser(res).id;
    const pass = await prisma.guestPass.findUnique({
      where: { codeHash: hashCode(tidyCode(body.code)) },
    });
    if (!pass) throw notFound("No guest pass with this code");
    const now = new Date();
    const state = passState(pass, now);
    if (state !== "active")
      throw new HttpError(409, `This guest pass is ${state.replace(/_/g, " ")}`);

    const plate = body.plate ? normalizePlate(body.plate) : null;
    const visit = await withTx((tx) =>
      admitWithPass(tx, pass.id, { plate, at: now, gateEventId: null, actorUserId: guardId }),
    );
    if (!visit) throw new HttpError(409, "This guest pass was just used up or revoked");
    const out = await loadVisit(visit.id);
    await publish("visit.updated", out, { staff: true, flatId: out.flatId });
    res.status(201).json(out);
  },
);
