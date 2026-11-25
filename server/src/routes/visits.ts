// Visits: guards register visitors; staff see everything, residents see their own flats;
// the guard decides after the residents' time is up; manual entry / exit at the gate.
import { Router } from "express";
import { z } from "zod";
import { prisma, withTx } from "../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { VisitCategory, VisitStatus } from "../../generated/prisma/enums.js";
import { currentUser, HttpError, notFound } from "../middleware.js";
import { defineRoute, IdParams, pageOf, PageQuery, roles } from "../openapi.js";
import { publish } from "../realtime.js";
import {
  ApprovalError,
  guardDecides,
  requestApproval,
  secondsLeft,
} from "../services/approvals.js";
import { cleanPlate, normalizePlate } from "../services/plates.js";
import { flatIdsOf, registerVisit, transitionVisit, VisitError } from "../services/visits.js";
import { flatLabel } from "./flats.js";
import { fullNameField, phoneField } from "./residents.js";

export const visitsRouter = Router();

/** "+919876543210" → "+91 98•••••210" (brief §10.7: phones masked in lists). */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  const prefix = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : "";
  if (local.length < 6) return `${prefix}${"•".repeat(local.length)}`;
  return `${prefix}${local.slice(0, 2)}${"•".repeat(local.length - 5)}${local.slice(-3)}`;
}

export const Visit = z
  .object({
    id: z.uuid(),
    flatId: z.uuid(),
    flatLabel: z.string(),
    status: z.enum(VisitStatus),
    category: z.enum(VisitCategory),
    purpose: z.string().nullable(),
    plate: z.string().nullable(),
    visitor: z
      .object({
        fullName: z.string().nullable(),
        phone: z.string().nullable(),
        email: z.string().nullable(),
      })
      .nullable(),
    guestPassId: z.uuid().nullable(),
    approval: z
      .object({
        id: z.uuid(),
        status: z.string(),
        expiresAt: z.iso.datetime(),
        secondsLeft: z.number().int(),
        channel: z.string().nullable(),
      })
      .nullable(),
    enteredAt: z.iso.datetime().nullable(),
    expectedExitAt: z.iso.datetime().nullable(),
    exitedAt: z.iso.datetime().nullable(),
    durationMinutes: z.number().int().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Visit" });

export const visitInclude = { flat: true, visitor: true, approval: true } as const;
type Row = Prisma.VisitGetPayload<{ include: typeof visitInclude }>;

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function toVisit(v: Row, opts: { maskPhones: boolean }): z.input<typeof Visit> {
  return {
    id: v.id,
    flatId: v.flatId,
    flatLabel: flatLabel(v.flat),
    status: v.status,
    category: v.category,
    purpose: v.purpose,
    plate: v.plateNormalized,
    visitor: v.visitor
      ? {
          fullName: v.visitor.fullName,
          phone: opts.maskPhones ? maskPhone(v.visitor.phone) : v.visitor.phone,
          email: v.visitor.email,
        }
      : null,
    guestPassId: v.guestPassId,
    approval: v.approval
      ? {
          id: v.approval.id,
          status: v.approval.status,
          expiresAt: v.approval.expiresAt.toISOString(),
          secondsLeft: secondsLeft(v.approval),
          channel: v.approval.channel,
        }
      : null,
    enteredAt: iso(v.enteredAt),
    expectedExitAt: iso(v.expectedExitAt),
    exitedAt: iso(v.exitedAt),
    durationMinutes: v.durationMinutes,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

/** Load a visit for output (full phone: staff and the host flat only reach this). */
export async function loadVisit(id: string) {
  return toVisit(await prisma.visit.findUniqueOrThrow({ where: { id }, include: visitInclude }), {
    maskPhones: false,
  });
}

/** Tell staff and the flat that a visit changed (after commit). */
export async function announceVisit(visitId: string): Promise<void> {
  const visit = await loadVisit(visitId);
  await publish("visit.updated", visit, { staff: true, flatId: visit.flatId });
}

function asHttp(err: unknown): never {
  if (err instanceof VisitError || err instanceof ApprovalError)
    throw new HttpError(err.status, err.message);
  throw err;
}

// ---------- Register ----------

const optionalPlate = z
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
  });

const RegisterBody = z.strictObject({
  flatId: z.uuid(),
  category: z.enum(VisitCategory),
  visitor: z.strictObject({
    fullName: fullNameField,
    phone: phoneField.optional(),
    email: z.email().max(254).toLowerCase().optional(),
  }),
  purpose: z.string().trim().max(200).optional(),
  plate: optionalPlate.optional().describe("If no gateEventId; the car's plate, if any"),
  gateEventId: z
    .uuid()
    .optional()
    .describe("The waiting car's read: approval then lets it in at once"),
  agreedDurationMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
});

defineRoute(
  visitsRouter,
  {
    method: "post",
    path: "/visits",
    tag: "Visits",
    summary: "Register a visitor and ask the flat's residents to approve",
    access: roles("admin", "guard"),
    body: RegisterBody,
    responses: {
      201: { description: "Waiting for approval", schema: Visit },
      404: { description: "Flat or gate event not found" },
      409: { description: "This car is already registered" },
    },
  },
  async ({ body, res }) => {
    const guardId = currentUser(res).id;
    const now = new Date();
    const visit = await withTx((tx) =>
      registerVisit(
        tx,
        {
          flatId: body.flatId,
          category: body.category,
          visitor: {
            fullName: body.visitor.fullName,
            phone: body.visitor.phone ?? null,
            email: body.visitor.email ?? null,
          },
          purpose: body.purpose ?? null,
          plate: body.plate ?? null,
          gateEventId: body.gateEventId ?? null,
          agreedDurationMinutes: body.agreedDurationMinutes ?? null,
        },
        guardId,
        now,
        requestApproval,
      ),
    ).catch(asHttp);
    const out = await loadVisit(visit.id);
    await publish("approval.requested", out, { staff: true, flatId: out.flatId });
    res.status(201).json(out);
  },
);

// ---------- Read ----------

const VisitQuery = PageQuery.extend({
  status: z.enum(VisitStatus).optional(),
  category: z.enum(VisitCategory).optional(),
  flatId: z.uuid().optional(),
  q: z.string().trim().max(60).optional().describe("Visitor name or plate contains"),
  since: z.iso.datetime({ offset: true }).optional(),
  until: z.iso.datetime({ offset: true }).optional(),
});

defineRoute(
  visitsRouter,
  {
    method: "get",
    path: "/visits",
    tag: "Visits",
    summary: "List visits, newest first (residents: their own flats; phones masked)",
    access: roles("admin", "guard", "resident"),
    query: VisitQuery,
    responses: { 200: { description: "Visits", schema: pageOf(Visit) } },
  },
  async ({ query, res }) => {
    const user = currentUser(res);
    const scope: Prisma.VisitWhereInput =
      user.role === "resident" ? { flatId: { in: await flatIdsOf(prisma, user.id) } } : {};
    const where: Prisma.VisitWhereInput = {
      AND: [
        scope,
        query.flatId ? { flatId: query.flatId } : {},
        query.status ? { status: query.status } : {},
        query.category ? { category: query.category } : {},
        query.q
          ? {
              OR: [
                { visitor: { fullName: { contains: query.q, mode: "insensitive" } } },
                { plateNormalized: { contains: cleanPlate(query.q) } },
              ],
            }
          : {},
        query.since || query.until
          ? {
              createdAt: {
                ...(query.since ? { gte: new Date(query.since) } : {}),
                ...(query.until ? { lt: new Date(query.until) } : {}),
              },
            }
          : {},
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.visit.findMany({
        where,
        include: visitInclude,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.visit.count({ where }),
    ]);
    res.json({
      items: rows.map((v) => toVisit(v, { maskPhones: true })),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  },
);

defineRoute(
  visitsRouter,
  {
    method: "get",
    path: "/visits/:id",
    tag: "Visits",
    summary: "Get one visit (full phone for staff and the host flat)",
    access: roles("admin", "guard", "resident"),
    params: IdParams,
    responses: { 200: { description: "Visit", schema: Visit }, 404: { description: "Not found" } },
  },
  async ({ params, res }) => {
    const user = currentUser(res);
    const visit = await prisma.visit.findUnique({
      where: { id: params.id },
      include: visitInclude,
    });
    if (!visit) throw notFound("Visit not found");
    if (user.role === "resident" && !(await flatIdsOf(prisma, user.id)).includes(visit.flatId)) {
      throw notFound("Visit not found");
    }
    res.json(toVisit(visit, { maskPhones: false }));
  },
);

// ---------- Guard decision, manual entry / exit ----------

defineRoute(
  visitsRouter,
  {
    method: "post",
    path: "/visits/:id/decision",
    tag: "Visits",
    summary: "Guard approves or denies after the residents' time is up",
    access: roles("admin", "guard"),
    params: IdParams,
    body: z.strictObject({ decision: z.enum(["approve", "deny"]) }),
    responses: {
      200: { description: "Decided", schema: Visit },
      409: { description: "Residents can still answer, or already decided" },
    },
  },
  async ({ params, body, res }) => {
    const result = await guardDecides(params.id, currentUser(res).id, body.decision).catch(asHttp);
    const out = await loadVisit(params.id);
    if (result.changed) {
      await publish("approval.decided", out, { staff: true, flatId: out.flatId });
      await publish("visit.updated", out, { staff: true, flatId: out.flatId });
    }
    res.json(out);
  },
);

for (const action of ["enter", "exit"] as const) {
  defineRoute(
    visitsRouter,
    {
      method: "post",
      path: `/visits/:id/${action}`,
      tag: "Visits",
      summary:
        action === "enter" ? "Manual entry (no camera read)" : "Manual exit (no camera read)",
      access: roles("admin", "guard"),
      params: IdParams,
      responses: {
        200: { description: "Updated", schema: Visit },
        404: { description: "Not found" },
        409: { description: "Not allowed from the visit's current status" },
      },
    },
    async ({ params, res }) => {
      const userId = currentUser(res).id;
      await withTx(async (tx) => {
        if (!(await tx.visit.findUnique({ where: { id: params.id }, select: { id: true } })))
          throw notFound("Visit not found");
        await transitionVisit(tx, params.id, action, { at: new Date(), actorUserId: userId });
      });
      await announceVisit(params.id);
      res.json(await loadVisit(params.id));
    },
  );
}
