// Residents: a resident user linked to a flat. Admins manage them; people are deactivated,
// never deleted (their history stays readable).
import { Router } from "express";
import { z } from "zod";
import { prisma, withTx } from "../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ResidentType } from "../../generated/prisma/enums.js";
import { currentUser, notFound } from "../middleware.js";
import { defineRoute, IdParams, pageOf, PageQuery, queryBool, roles } from "../openapi.js";
import { recordAudit } from "../services/audit.js";
import { hashPassword, revokeAllSessions } from "../services/auth.js";
import { flatLabel } from "./flats.js";

export const residentsRouter = Router();

// Shared by residents and guards.
export const emailField = z.email().max(254).toLowerCase();
export const fullNameField = z.string().trim().min(1).max(120);
export const phoneField = z
  .string()
  .trim()
  .regex(/^\+?\d{10,15}$/, "Phone is 10–15 digits, optionally starting with +, e.g. +919876543210");
export const passwordField = z.string().min(10, "Password must be at least 10 characters").max(200);

const Resident = z
  .object({
    id: z.uuid(),
    flatId: z.uuid(),
    flatLabel: z.string(),
    residentType: z.enum(ResidentType),
    isPrimaryContact: z.boolean(),
    user: z.object({
      id: z.uuid(),
      email: z.string(),
      fullName: z.string(),
      phone: z.string().nullable(),
      isActive: z.boolean(),
    }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Resident" });

const include = { user: true, flat: true } as const;
type Row = Prisma.ResidentGetPayload<{ include: typeof include }>;

const toResident = (r: Row): z.input<typeof Resident> => ({
  id: r.id,
  flatId: r.flatId,
  flatLabel: flatLabel(r.flat),
  residentType: r.residentType,
  isPrimaryContact: r.isPrimaryContact,
  user: {
    id: r.user.id,
    email: r.user.email,
    fullName: r.user.fullName,
    phone: r.user.phone,
    isActive: r.user.isActive,
  },
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/** Flat view of a resident for the audit log (includes the hash so a change is noted, never shown). */
const snapshot = (r: Row) => ({
  email: r.user.email,
  fullName: r.user.fullName,
  phone: r.user.phone,
  isActive: r.user.isActive,
  passwordHash: r.user.passwordHash,
  flatId: r.flatId,
  residentType: r.residentType,
  isPrimaryContact: r.isPrimaryContact,
});

const ResidentCreate = z.strictObject({
  email: emailField,
  fullName: fullNameField,
  phone: phoneField.optional(),
  password: passwordField,
  flatId: z.uuid(),
  residentType: z.enum(ResidentType),
  isPrimaryContact: z.boolean().default(false),
});

const ResidentUpdate = z
  .strictObject({
    email: emailField.optional(),
    fullName: fullNameField.optional(),
    phone: phoneField.nullable().optional(),
    password: passwordField.optional(),
    residentType: z.enum(ResidentType).optional(),
    isPrimaryContact: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Send at least one field to change");

const ResidentQuery = PageQuery.extend({
  q: z.string().trim().max(100).optional().describe("Name or email contains"),
  flatId: z.uuid().optional(),
  isActive: queryBool.optional(),
});

defineRoute(
  residentsRouter,
  {
    method: "get",
    path: "/residents",
    tag: "Residents",
    summary: "List residents",
    access: roles("admin"),
    query: ResidentQuery,
    responses: { 200: { description: "Residents", schema: pageOf(Resident) } },
  },
  async ({ query, res }) => {
    const where: Prisma.ResidentWhereInput = {
      ...(query.flatId ? { flatId: query.flatId } : {}),
      user: {
        ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
        ...(query.q
          ? {
              OR: [
                { fullName: { contains: query.q, mode: "insensitive" } },
                { email: { contains: query.q.toLowerCase() } },
              ],
            }
          : {}),
      },
    };
    const [rows, total] = await Promise.all([
      prisma.resident.findMany({
        where,
        include,
        orderBy: [{ flat: { block: "asc" } }, { flat: { number: "asc" } }, { createdAt: "asc" }],
        take: query.limit,
        skip: query.offset,
      }),
      prisma.resident.count({ where }),
    ]);
    res.json({ items: rows.map(toResident), total, limit: query.limit, offset: query.offset });
  },
);

defineRoute(
  residentsRouter,
  {
    method: "get",
    path: "/residents/:id",
    tag: "Residents",
    summary: "Get a resident",
    access: roles("admin"),
    params: IdParams,
    responses: {
      200: { description: "Resident", schema: Resident },
      404: { description: "Not found" },
    },
  },
  async ({ params, res }) => {
    const row = await prisma.resident.findUnique({ where: { id: params.id }, include });
    if (!row) throw notFound("Resident not found");
    res.json(toResident(row));
  },
);

defineRoute(
  residentsRouter,
  {
    method: "post",
    path: "/residents",
    tag: "Residents",
    summary: "Add a resident (creates their login)",
    access: roles("admin"),
    body: ResidentCreate,
    responses: {
      201: { description: "Created", schema: Resident },
      404: { description: "Flat not found" },
      409: { description: "Email taken or flat already has a primary contact" },
    },
  },
  async ({ body, res }) => {
    const actorId = currentUser(res).id;
    const passwordHash = await hashPassword(body.password);
    const row = await withTx(async (tx) => {
      const flat = await tx.flat.findUnique({ where: { id: body.flatId } });
      if (!flat) throw notFound("Flat not found");
      const user = await tx.user.create({
        data: {
          email: body.email,
          fullName: body.fullName,
          phone: body.phone ?? null,
          role: "resident",
          passwordHash,
        },
      });
      const created = await tx.resident.create({
        data: {
          userId: user.id,
          flatId: body.flatId,
          residentType: body.residentType,
          isPrimaryContact: body.isPrimaryContact,
        },
        include,
      });
      await recordAudit(tx, {
        actorId,
        action: "resident.create",
        entityType: "resident",
        entityId: created.id,
        after: snapshot(created),
      });
      return created;
    });
    res.status(201).json(toResident(row));
  },
);

defineRoute(
  residentsRouter,
  {
    method: "patch",
    path: "/residents/:id",
    tag: "Residents",
    summary: "Change a resident (isActive=false deactivates and signs them out)",
    access: roles("admin"),
    params: IdParams,
    body: ResidentUpdate,
    responses: {
      200: { description: "Updated", schema: Resident },
      404: { description: "Not found" },
      409: { description: "Conflict" },
    },
  },
  async ({ params, body, res }) => {
    const actorId = currentUser(res).id;
    const passwordHash = body.password ? await hashPassword(body.password) : undefined;
    const row = await withTx(async (tx) => {
      const before = await tx.resident.findUnique({ where: { id: params.id }, include });
      if (!before) throw notFound("Resident not found");
      await tx.user.update({
        where: { id: before.userId },
        data: {
          ...(body.email !== undefined ? { email: body.email } : {}),
          ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        },
      });
      const after = await tx.resident.update({
        where: { id: params.id },
        data: {
          ...(body.residentType !== undefined ? { residentType: body.residentType } : {}),
          ...(body.isPrimaryContact !== undefined
            ? { isPrimaryContact: body.isPrimaryContact }
            : {}),
        },
        include,
      });
      await recordAudit(tx, {
        actorId,
        action: "resident.update",
        entityType: "resident",
        entityId: after.id,
        before: snapshot(before),
        after: snapshot(after),
      });
      return after;
    });
    if (body.isActive === false || passwordHash) await revokeAllSessions(row.userId);
    res.json(toResident(row));
  },
);

defineRoute(
  residentsRouter,
  {
    method: "delete",
    path: "/residents/:id",
    tag: "Residents",
    summary: "Deactivate a resident (people are never deleted)",
    access: roles("admin"),
    params: IdParams,
    responses: { 204: { description: "Deactivated" }, 404: { description: "Not found" } },
  },
  async ({ params, res }) => {
    const actorId = currentUser(res).id;
    const userId = await withTx(async (tx) => {
      const before = await tx.resident.findUnique({ where: { id: params.id }, include });
      if (!before) throw notFound("Resident not found");
      await tx.user.update({ where: { id: before.userId }, data: { isActive: false } });
      await recordAudit(tx, {
        actorId,
        action: "resident.deactivate",
        entityType: "resident",
        entityId: before.id,
        before: { isActive: before.user.isActive },
        after: { isActive: false },
      });
      return before.userId;
    });
    await revokeAllSessions(userId);
    res.status(204).end();
  },
);
