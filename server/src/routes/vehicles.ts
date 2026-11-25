// Resident vehicles. A vehicle belongs to a flat. Plates are cleaned and validated on the way in.
import { Router } from "express";
import { z } from "zod";
import { prisma, withTx } from "../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { VehicleType } from "../../generated/prisma/enums.js";
import { currentUser, notFound } from "../middleware.js";
import { defineRoute, IdParams, pageOf, PageQuery, queryBool, roles } from "../openapi.js";
import { recordAudit } from "../services/audit.js";
import { cleanPlate, normalizePlate } from "../services/plates.js";
import { flatLabel } from "./flats.js";

export const vehiclesRouter = Router();

/** A typed plate: kept as typed (raw) and as the cleaned, validated form. */
export const plateField = z
  .string()
  .trim()
  .min(4)
  .max(32)
  .transform((raw, ctx) => {
    const normalized = normalizePlate(raw);
    if (!normalized) {
      ctx.addIssue({
        code: "custom",
        message: "Not a valid Indian number plate (e.g. UP16AB1234 or 22BH1234AA)",
      });
      return z.NEVER;
    }
    return { raw, normalized };
  })
  .describe("Spaces and dashes are fine, e.g. UP16 AB 1234");

const Vehicle = z
  .object({
    id: z.uuid(),
    flatId: z.uuid(),
    flatLabel: z.string(),
    plate: z.string().describe("Cleaned plate, e.g. UP16AB1234"),
    plateRaw: z.string().describe("As typed"),
    vehicleType: z.enum(VehicleType),
    makeModel: z.string().nullable(),
    colour: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Vehicle" });

const include = { flat: true } as const;
type Row = Prisma.VehicleGetPayload<{ include: typeof include }>;

const toVehicle = (v: Row): z.input<typeof Vehicle> => ({
  id: v.id,
  flatId: v.flatId,
  flatLabel: flatLabel(v.flat),
  plate: v.plateNormalized,
  plateRaw: v.plateRaw,
  vehicleType: v.vehicleType,
  makeModel: v.makeModel,
  colour: v.colour,
  isActive: v.isActive,
  createdAt: v.createdAt.toISOString(),
  updatedAt: v.updatedAt.toISOString(),
});

const snapshot = ({ flat: _flat, ...v }: Row) => v;

const text = z.string().trim().min(1).max(60);

const VehicleCreate = z.strictObject({
  flatId: z.uuid(),
  plate: plateField,
  vehicleType: z.enum(VehicleType),
  makeModel: text.optional(),
  colour: text.optional(),
});

const VehicleUpdate = z
  .strictObject({
    flatId: z.uuid().optional(),
    plate: plateField.optional(),
    vehicleType: z.enum(VehicleType).optional(),
    makeModel: text.nullable().optional(),
    colour: text.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Send at least one field to change");

const VehicleQuery = PageQuery.extend({
  q: z.string().trim().max(32).optional().describe("Plate contains (spaces ignored)"),
  flatId: z.uuid().optional(),
  vehicleType: z.enum(VehicleType).optional(),
  isActive: queryBool.optional(),
});

defineRoute(
  vehiclesRouter,
  {
    method: "get",
    path: "/vehicles",
    tag: "Vehicles",
    summary: "List vehicles",
    access: roles("admin", "guard"),
    query: VehicleQuery,
    responses: { 200: { description: "Vehicles", schema: pageOf(Vehicle) } },
  },
  async ({ query, res }) => {
    const where: Prisma.VehicleWhereInput = {
      ...(query.q ? { plateNormalized: { contains: cleanPlate(query.q) } } : {}),
      ...(query.flatId ? { flatId: query.flatId } : {}),
      ...(query.vehicleType ? { vehicleType: query.vehicleType } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    };
    const [rows, total] = await Promise.all([
      prisma.vehicle.findMany({
        where,
        include,
        orderBy: { plateNormalized: "asc" },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.vehicle.count({ where }),
    ]);
    res.json({ items: rows.map(toVehicle), total, limit: query.limit, offset: query.offset });
  },
);

defineRoute(
  vehiclesRouter,
  {
    method: "get",
    path: "/vehicles/:id",
    tag: "Vehicles",
    summary: "Get a vehicle",
    access: roles("admin", "guard"),
    params: IdParams,
    responses: {
      200: { description: "Vehicle", schema: Vehicle },
      404: { description: "Not found" },
    },
  },
  async ({ params, res }) => {
    const row = await prisma.vehicle.findUnique({ where: { id: params.id }, include });
    if (!row) throw notFound("Vehicle not found");
    res.json(toVehicle(row));
  },
);

defineRoute(
  vehiclesRouter,
  {
    method: "post",
    path: "/vehicles",
    tag: "Vehicles",
    summary: "Register a resident vehicle",
    access: roles("admin"),
    body: VehicleCreate,
    responses: {
      201: { description: "Created", schema: Vehicle },
      404: { description: "Flat not found" },
      409: { description: "Plate already registered" },
    },
  },
  async ({ body, res }) => {
    const actorId = currentUser(res).id;
    const row = await withTx(async (tx) => {
      if (!(await tx.flat.findUnique({ where: { id: body.flatId } })))
        throw notFound("Flat not found");
      const created = await tx.vehicle.create({
        data: {
          flatId: body.flatId,
          plateRaw: body.plate.raw,
          plateNormalized: body.plate.normalized,
          vehicleType: body.vehicleType,
          makeModel: body.makeModel ?? null,
          colour: body.colour ?? null,
        },
        include,
      });
      await recordAudit(tx, {
        actorId,
        action: "vehicle.create",
        entityType: "vehicle",
        entityId: created.id,
        after: snapshot(created),
      });
      return created;
    });
    res.status(201).json(toVehicle(row));
  },
);

defineRoute(
  vehiclesRouter,
  {
    method: "patch",
    path: "/vehicles/:id",
    tag: "Vehicles",
    summary: "Change a vehicle",
    access: roles("admin"),
    params: IdParams,
    body: VehicleUpdate,
    responses: {
      200: { description: "Updated", schema: Vehicle },
      404: { description: "Not found" },
      409: { description: "Plate already registered" },
    },
  },
  async ({ params, body, res }) => {
    const actorId = currentUser(res).id;
    const row = await withTx(async (tx) => {
      const before = await tx.vehicle.findUnique({ where: { id: params.id }, include });
      if (!before) throw notFound("Vehicle not found");
      if (body.flatId && !(await tx.flat.findUnique({ where: { id: body.flatId } })))
        throw notFound("Flat not found");
      const after = await tx.vehicle.update({
        where: { id: params.id },
        data: {
          ...(body.flatId !== undefined ? { flatId: body.flatId } : {}),
          ...(body.plate !== undefined
            ? { plateRaw: body.plate.raw, plateNormalized: body.plate.normalized }
            : {}),
          ...(body.vehicleType !== undefined ? { vehicleType: body.vehicleType } : {}),
          ...(body.makeModel !== undefined ? { makeModel: body.makeModel } : {}),
          ...(body.colour !== undefined ? { colour: body.colour } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
        include,
      });
      await recordAudit(tx, {
        actorId,
        action: "vehicle.update",
        entityType: "vehicle",
        entityId: after.id,
        before: snapshot(before),
        after: snapshot(after),
      });
      return after;
    });
    res.json(toVehicle(row));
  },
);

defineRoute(
  vehiclesRouter,
  {
    method: "delete",
    path: "/vehicles/:id",
    tag: "Vehicles",
    summary: "Delete a vehicle (past gate events keep the plate text)",
    access: roles("admin"),
    params: IdParams,
    responses: { 204: { description: "Deleted" }, 404: { description: "Not found" } },
  },
  async ({ params, res }) => {
    const actorId = currentUser(res).id;
    await withTx(async (tx) => {
      const before = await tx.vehicle.findUnique({ where: { id: params.id }, include });
      if (!before) throw notFound("Vehicle not found");
      await tx.vehicle.delete({ where: { id: params.id } });
      await recordAudit(tx, {
        actorId,
        action: "vehicle.delete",
        entityType: "vehicle",
        entityId: before.id,
        before: snapshot(before),
      });
    });
    res.status(204).end();
  },
);
