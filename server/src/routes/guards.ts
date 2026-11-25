// Guards: staff logins for the gate console. Admins manage them; deactivated, never deleted.
import { Router } from "express";
import { z } from "zod";
import { prisma, withTx } from "../db.js";
import type { Prisma, User } from "../../generated/prisma/client.js";
import { currentUser, notFound } from "../middleware.js";
import { defineRoute, IdParams, pageOf, PageQuery, queryBool, roles } from "../openapi.js";
import { recordAudit } from "../services/audit.js";
import { hashPassword, revokeAllSessions } from "../services/auth.js";
import { emailField, fullNameField, passwordField, phoneField } from "./residents.js";

export const guardsRouter = Router();

const Guard = z
  .object({
    id: z.uuid(),
    email: z.string(),
    fullName: z.string(),
    phone: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Guard" });

const toGuard = (u: User): z.input<typeof Guard> => ({
  id: u.id,
  email: u.email,
  fullName: u.fullName,
  phone: u.phone,
  isActive: u.isActive,
  createdAt: u.createdAt.toISOString(),
  updatedAt: u.updatedAt.toISOString(),
});

const snapshot = (u: User) => ({
  email: u.email,
  fullName: u.fullName,
  phone: u.phone,
  isActive: u.isActive,
  passwordHash: u.passwordHash,
});

const GuardCreate = z.strictObject({
  email: emailField,
  fullName: fullNameField,
  phone: phoneField.optional(),
  password: passwordField,
});

const GuardUpdate = z
  .strictObject({
    email: emailField.optional(),
    fullName: fullNameField.optional(),
    phone: phoneField.nullable().optional(),
    password: passwordField.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Send at least one field to change");

async function findGuard(db: Prisma.TransactionClient, id: string): Promise<User> {
  const user = await db.user.findFirst({ where: { id, role: "guard" } });
  if (!user) throw notFound("Guard not found");
  return user;
}

defineRoute(
  guardsRouter,
  {
    method: "get",
    path: "/guards",
    tag: "Guards",
    summary: "List guards",
    access: roles("admin"),
    query: PageQuery.extend({
      q: z.string().trim().max(100).optional(),
      isActive: queryBool.optional(),
    }),
    responses: { 200: { description: "Guards", schema: pageOf(Guard) } },
  },
  async ({ query, res }) => {
    const where: Prisma.UserWhereInput = {
      role: "guard",
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.q
        ? {
            OR: [
              { fullName: { contains: query.q, mode: "insensitive" } },
              { email: { contains: query.q.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { fullName: "asc" },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.user.count({ where }),
    ]);
    res.json({ items: rows.map(toGuard), total, limit: query.limit, offset: query.offset });
  },
);

defineRoute(
  guardsRouter,
  {
    method: "get",
    path: "/guards/:id",
    tag: "Guards",
    summary: "Get a guard",
    access: roles("admin"),
    params: IdParams,
    responses: { 200: { description: "Guard", schema: Guard }, 404: { description: "Not found" } },
  },
  async ({ params, res }) => {
    res.json(toGuard(await findGuard(prisma, params.id)));
  },
);

defineRoute(
  guardsRouter,
  {
    method: "post",
    path: "/guards",
    tag: "Guards",
    summary: "Add a guard (creates their login)",
    access: roles("admin"),
    body: GuardCreate,
    responses: {
      201: { description: "Created", schema: Guard },
      409: { description: "Email taken" },
    },
  },
  async ({ body, res }) => {
    const actorId = currentUser(res).id;
    const passwordHash = await hashPassword(body.password);
    const guard = await withTx(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: body.email,
          fullName: body.fullName,
          phone: body.phone ?? null,
          role: "guard",
          passwordHash,
        },
      });
      await recordAudit(tx, {
        actorId,
        action: "guard.create",
        entityType: "guard",
        entityId: created.id,
        after: snapshot(created),
      });
      return created;
    });
    res.status(201).json(toGuard(guard));
  },
);

defineRoute(
  guardsRouter,
  {
    method: "patch",
    path: "/guards/:id",
    tag: "Guards",
    summary: "Change a guard (isActive=false deactivates and signs them out)",
    access: roles("admin"),
    params: IdParams,
    body: GuardUpdate,
    responses: {
      200: { description: "Updated", schema: Guard },
      404: { description: "Not found" },
      409: { description: "Email taken" },
    },
  },
  async ({ params, body, res }) => {
    const actorId = currentUser(res).id;
    const passwordHash = body.password ? await hashPassword(body.password) : undefined;
    const guard = await withTx(async (tx) => {
      const before = await findGuard(tx, params.id);
      const after = await tx.user.update({
        where: { id: before.id },
        data: {
          ...(body.email !== undefined ? { email: body.email } : {}),
          ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        },
      });
      await recordAudit(tx, {
        actorId,
        action: "guard.update",
        entityType: "guard",
        entityId: after.id,
        before: snapshot(before),
        after: snapshot(after),
      });
      return after;
    });
    if (body.isActive === false || passwordHash) await revokeAllSessions(guard.id);
    res.json(toGuard(guard));
  },
);

defineRoute(
  guardsRouter,
  {
    method: "delete",
    path: "/guards/:id",
    tag: "Guards",
    summary: "Deactivate a guard (people are never deleted)",
    access: roles("admin"),
    params: IdParams,
    responses: { 204: { description: "Deactivated" }, 404: { description: "Not found" } },
  },
  async ({ params, res }) => {
    const actorId = currentUser(res).id;
    await withTx(async (tx) => {
      const before = await findGuard(tx, params.id);
      await tx.user.update({ where: { id: before.id }, data: { isActive: false } });
      await recordAudit(tx, {
        actorId,
        action: "guard.deactivate",
        entityType: "guard",
        entityId: before.id,
        before: { isActive: before.isActive },
        after: { isActive: false },
      });
    });
    await revokeAllSessions(params.id);
    res.status(204).end();
  },
);
