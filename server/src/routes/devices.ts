// Camera devices: one per gate lane (entry or exit). A device authenticates with a key
// `vd_` + 32 random bytes. The key is returned ONCE (on create / rotate); only its SHA-256
// and a short prefix (to recognise it in lists) are stored.
import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma, withTx } from "../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { LaneDirection } from "../../generated/prisma/enums.js";
import { currentDevice, currentUser, hashDeviceKey, notFound } from "../middleware.js";
import { defineRoute, DEVICE, IdParams, pageOf, PageQuery, queryBool, roles } from "../openapi.js";
import { recordAudit } from "../services/audit.js";

export const devicesRouter = Router();

/** A new random device key and what we store about it. */
export function newDeviceKey(): { key: string; hash: string; prefix: string } {
  const key = `vd_${randomBytes(32).toString("base64url")}`;
  return { key, hash: hashDeviceKey(key), prefix: key.slice(0, 11) };
}

const Device = z
  .object({
    id: z.uuid(),
    gateId: z.uuid(),
    gateName: z.string(),
    name: z.string(),
    direction: z.enum(LaneDirection),
    apiKeyPrefix: z.string().describe("First characters of the key, to recognise it"),
    lastSeenAt: z.iso.datetime().nullable(),
    isActive: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Device" });

const DeviceWithKey = Device.extend({
  apiKey: z.string().describe("Shown only now. Store it on the camera; it cannot be shown again."),
}).meta({ id: "DeviceWithKey" });

const include = { gate: true } as const;
type Row = Prisma.DeviceGetPayload<{ include: typeof include }>;

const toDevice = (d: Row): z.input<typeof Device> => ({
  id: d.id,
  gateId: d.gateId,
  gateName: d.gate.name,
  name: d.name,
  direction: d.direction,
  apiKeyPrefix: d.apiKeyPrefix,
  lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
  isActive: d.isActive,
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
});

const snapshot = ({ gate: _gate, ...d }: Row) => d;

const name = z.string().trim().min(1).max(60);

// GET /devices/me is declared before /devices/:id so "me" is not read as an id.
defineRoute(
  devicesRouter,
  {
    method: "get",
    path: "/devices/me",
    tag: "Devices",
    summary: "Camera checks its own key",
    access: DEVICE,
    responses: {
      200: {
        description: "This device",
        schema: z.object({
          id: z.uuid(),
          name: z.string(),
          direction: z.enum(LaneDirection),
          gateId: z.uuid(),
        }),
      },
    },
  },
  ({ res }) => {
    const d = currentDevice(res);
    res.json({ id: d.id, name: d.name, direction: d.direction, gateId: d.gateId });
  },
);

defineRoute(
  devicesRouter,
  {
    method: "get",
    path: "/devices",
    tag: "Devices",
    summary: "List camera devices",
    access: roles("admin"),
    query: PageQuery.extend({ gateId: z.uuid().optional(), isActive: queryBool.optional() }),
    responses: { 200: { description: "Devices", schema: pageOf(Device) } },
  },
  async ({ query, res }) => {
    const where: Prisma.DeviceWhereInput = {
      ...(query.gateId ? { gateId: query.gateId } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    };
    const [rows, total] = await Promise.all([
      prisma.device.findMany({
        where,
        include,
        orderBy: [{ gate: { name: "asc" } }, { name: "asc" }],
        take: query.limit,
        skip: query.offset,
      }),
      prisma.device.count({ where }),
    ]);
    res.json({ items: rows.map(toDevice), total, limit: query.limit, offset: query.offset });
  },
);

defineRoute(
  devicesRouter,
  {
    method: "get",
    path: "/devices/:id",
    tag: "Devices",
    summary: "Get a camera device",
    access: roles("admin"),
    params: IdParams,
    responses: {
      200: { description: "Device", schema: Device },
      404: { description: "Not found" },
    },
  },
  async ({ params, res }) => {
    const row = await prisma.device.findUnique({ where: { id: params.id }, include });
    if (!row) throw notFound("Device not found");
    res.json(toDevice(row));
  },
);

defineRoute(
  devicesRouter,
  {
    method: "post",
    path: "/devices",
    tag: "Devices",
    summary: "Add a camera device (returns its key once)",
    access: roles("admin"),
    body: z.strictObject({ gateId: z.uuid(), name, direction: z.enum(LaneDirection) }),
    responses: {
      201: { description: "Created", schema: DeviceWithKey },
      404: { description: "Gate not found" },
      409: { description: "Name taken at this gate" },
    },
  },
  async ({ body, res }) => {
    const actorId = currentUser(res).id;
    const { key, hash, prefix } = newDeviceKey();
    const row = await withTx(async (tx) => {
      if (!(await tx.gate.findUnique({ where: { id: body.gateId } })))
        throw notFound("Gate not found");
      const created = await tx.device.create({
        data: {
          gateId: body.gateId,
          name: body.name,
          direction: body.direction,
          apiKeyHash: hash,
          apiKeyPrefix: prefix,
        },
        include,
      });
      await recordAudit(tx, {
        actorId,
        action: "device.create",
        entityType: "device",
        entityId: created.id,
        after: snapshot(created),
      });
      return created;
    });
    res.status(201).json({ ...toDevice(row), apiKey: key });
  },
);

defineRoute(
  devicesRouter,
  {
    method: "patch",
    path: "/devices/:id",
    tag: "Devices",
    summary: "Change a camera device",
    access: roles("admin"),
    params: IdParams,
    body: z
      .strictObject({
        name: name.optional(),
        direction: z.enum(LaneDirection).optional(),
        isActive: z.boolean().optional(),
      })
      .refine((v) => Object.keys(v).length > 0, "Send at least one field to change"),
    responses: {
      200: { description: "Updated", schema: Device },
      404: { description: "Not found" },
      409: { description: "Name taken at this gate" },
    },
  },
  async ({ params, body, res }) => {
    const actorId = currentUser(res).id;
    const row = await withTx(async (tx) => {
      const before = await tx.device.findUnique({ where: { id: params.id }, include });
      if (!before) throw notFound("Device not found");
      const after = await tx.device.update({ where: { id: params.id }, data: body, include });
      await recordAudit(tx, {
        actorId,
        action: "device.update",
        entityType: "device",
        entityId: after.id,
        before: snapshot(before),
        after: snapshot(after),
      });
      return after;
    });
    res.json(toDevice(row));
  },
);

defineRoute(
  devicesRouter,
  {
    method: "post",
    path: "/devices/:id/rotate-key",
    tag: "Devices",
    summary: "Replace a device's key (the old key stops working; the new one is returned once)",
    access: roles("admin"),
    params: IdParams,
    responses: {
      200: { description: "New key", schema: DeviceWithKey },
      404: { description: "Not found" },
    },
  },
  async ({ params, res }) => {
    const actorId = currentUser(res).id;
    const { key, hash, prefix } = newDeviceKey();
    const row = await withTx(async (tx) => {
      const before = await tx.device.findUnique({ where: { id: params.id }, include });
      if (!before) throw notFound("Device not found");
      const after = await tx.device.update({
        where: { id: params.id },
        data: { apiKeyHash: hash, apiKeyPrefix: prefix },
        include,
      });
      await recordAudit(tx, {
        actorId,
        action: "device.rotate_key",
        entityType: "device",
        entityId: after.id,
        before: snapshot(before),
        after: snapshot(after),
      });
      return after;
    });
    res.json({ ...toDevice(row), apiKey: key });
  },
);

defineRoute(
  devicesRouter,
  {
    method: "delete",
    path: "/devices/:id",
    tag: "Devices",
    summary: "Delete a camera device (only if it never sent events; otherwise deactivate it)",
    access: roles("admin"),
    params: IdParams,
    responses: {
      204: { description: "Deleted" },
      404: { description: "Not found" },
      409: { description: "Has gate events" },
    },
  },
  async ({ params, res }) => {
    const actorId = currentUser(res).id;
    await withTx(async (tx) => {
      const before = await tx.device.findUnique({ where: { id: params.id }, include });
      if (!before) throw notFound("Device not found");
      await tx.device.delete({ where: { id: params.id } });
      await recordAudit(tx, {
        actorId,
        action: "device.delete",
        entityType: "device",
        entityId: before.id,
        before: snapshot(before),
      });
    });
    res.status(204).end();
  },
);
