// Gate events: cameras post reads; staff list them, open the review queue, view snapshots,
// and settle unclear reads. The decisions themselves live in services/gateEvents.ts.
import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { LaneDirection, MatchResult } from "../../generated/prisma/enums.js";
import { currentDevice, currentUser, HttpError, notFound } from "../middleware.js";
import { publish } from "../realtime.js";
import { DEVICE, defineRoute, IdParams, pageOf, PageQuery, queryBool, roles } from "../openapi.js";
import { ingestRead, ReviewError, reviewEvent } from "../services/gateEvents.js";
import { cleanPlate, normalizePlate } from "../services/plates.js";
import {
  deleteSnapshot,
  detectImageType,
  loadSnapshot,
  saveSnapshot,
  snapshotKey,
  contentTypeOf,
} from "../services/storage.js";
import { flatLabel } from "./flats.js";
import { announceVisit } from "./visits.js";

export const gateEventsRouter = Router();

// ---------- Response shape ----------

const GateEvent = z
  .object({
    id: z.uuid(),
    gateId: z.uuid(),
    gateName: z.string(),
    deviceId: z.uuid(),
    direction: z.enum(LaneDirection),
    plate: z.string().describe("Repaired plate (or cleaned text if unreadable)"),
    plateRaw: z.string().describe("Exactly what the camera sent"),
    ocrFixes: z.number().int(),
    confidence: z.number(),
    capturedAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime(),
    matchResult: z.enum(MatchResult),
    matchDistance: z.number().int().nullable(),
    vehicle: z.object({ id: z.uuid(), plate: z.string(), flatLabel: z.string() }).nullable(),
    visitId: z.uuid().nullable(),
    pairedEventId: z.uuid().nullable().describe("For a resident's exit: the entry it closes"),
    needsReview: z.boolean(),
    reviewReason: z.string().nullable(),
    reviewedAt: z.iso.datetime().nullable(),
    hasSnapshot: z.boolean(),
    alertIds: z.array(z.uuid()),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "GateEvent" });

const include = {
  gate: { select: { name: true } },
  vehicle: { include: { flat: true } },
  alerts: { select: { id: true } },
} as const;
type Row = Prisma.GateEventGetPayload<{ include: typeof include }>;

const toEvent = (e: Row): z.input<typeof GateEvent> => ({
  id: e.id,
  gateId: e.gateId,
  gateName: e.gate.name,
  deviceId: e.deviceId,
  direction: e.direction,
  plate: e.plateNormalized,
  plateRaw: e.plateRaw,
  ocrFixes: e.ocrFixes,
  confidence: e.confidence,
  capturedAt: e.capturedAt.toISOString(),
  lastSeenAt: e.lastSeenAt.toISOString(),
  matchResult: e.matchResult,
  matchDistance: e.matchDistance,
  vehicle: e.vehicle
    ? { id: e.vehicle.id, plate: e.vehicle.plateNormalized, flatLabel: flatLabel(e.vehicle.flat) }
    : null,
  visitId: e.visitId,
  pairedEventId: e.pairedEventId,
  needsReview: e.needsReview,
  reviewReason: e.reviewReason,
  reviewedAt: e.reviewedAt?.toISOString() ?? null,
  hasSnapshot: e.snapshotKey !== null,
  alertIds: e.alerts.map((a) => a.id),
  createdAt: e.createdAt.toISOString(),
});

const loadEvent = async (id: string) =>
  toEvent(await prisma.gateEvent.findUniqueOrThrow({ where: { id }, include }));

/** Real time, after commit: the event for staff, any new alert, and the visit it moved. */
async function announceEvent(event: z.input<typeof GateEvent>): Promise<void> {
  await publish("gate_event.created", event, { staff: true });
  const alerts = await prisma.alert.findMany({
    where: { gateEventId: event.id, acknowledgedAt: null },
  });
  for (const alert of alerts)
    await publish("alert.created", { ...alert, plate: event.plate }, { staff: true });
  if (event.visitId) await announceVisit(event.visitId);
}

// ---------- Camera upload ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.SNAPSHOT_MAX_BYTES, files: 1, fields: 10 },
}).single("snapshot");

const CameraRead = z.strictObject({
  plate_text: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe("As read; spaces, dashes and look-alikes are fixed by the server"),
  confidence: z.coerce.number().min(0).max(1).describe("OCR confidence, 0–1"),
  captured_at: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("ISO 8601 with time zone; default: now"),
  direction: z.enum(LaneDirection).optional().describe("Must match the camera's lane if sent"),
  snapshot: z
    .string()
    .optional()
    .meta({ format: "binary", description: "JPEG/PNG/WebP, max 2 MB" }),
});

defineRoute(
  gateEventsRouter,
  {
    method: "post",
    path: "/gate-events",
    tag: "Gate events",
    summary: "Camera posts one plate read",
    description:
      "Multipart form. 201 `created` (new event), 200 `duplicate` (exact retry), 200 `debounced` (same car within 30 s). Rate limited per device key.",
    access: DEVICE,
    bodyType: "multipart",
    upload,
    body: CameraRead,
    responses: {
      200: {
        description: "Duplicate or debounced",
        schema: z.object({ status: z.enum(["duplicate", "debounced"]), event: GateEvent }),
      },
      201: {
        description: "Created",
        schema: z.object({ status: z.literal("created"), event: GateEvent }),
      },
      413: { description: "Snapshot too large" },
      429: { description: "Too many reads from this camera" },
    },
  },
  async ({ body, req, res }) => {
    const device = currentDevice(res);
    if (body.direction && body.direction !== device.direction) {
      throw new HttpError(
        422,
        `This camera is on the ${device.direction} lane, not ${body.direction}`,
      );
    }
    const capturedAt = body.captured_at ? new Date(body.captured_at) : new Date();
    if (capturedAt.getTime() > Date.now() + config.GATE_EVENT_MAX_CLOCK_SKEW_SECONDS * 1000) {
      throw new HttpError(422, "captured_at is too far in the future; check the camera's clock");
    }

    // Save the snapshot first under a fresh event id; if the read turns out to be a retry or
    // the same car, the file is deleted again.
    const eventId = randomUUID();
    let key: string | null = null;
    if (req.file) {
      const type = detectImageType(req.file.buffer);
      if (!type) throw new HttpError(422, "Snapshot must be a JPEG, PNG or WebP image");
      key = snapshotKey(eventId, capturedAt, type.ext);
      await saveSnapshot(key, req.file.buffer);
    }

    let result;
    try {
      result = await ingestRead({
        deviceId: device.id,
        gateId: device.gateId,
        direction: device.direction,
        plateText: body.plate_text,
        confidence: body.confidence,
        capturedAt,
        eventId,
        snapshotKey: key,
      });
    } catch (err) {
      if (key) await deleteSnapshot(key);
      throw err;
    }
    if (key && result.event.id !== eventId) await deleteSnapshot(key);

    const event = await loadEvent(result.event.id);
    if (result.status === "created") await announceEvent(event);
    res.status(result.status === "created" ? 201 : 200).json({ status: result.status, event });
  },
);

// ---------- Staff: list, review queue, one event, snapshot ----------

const EventQuery = PageQuery.extend({
  direction: z.enum(LaneDirection).optional(),
  matchResult: z.enum(MatchResult).optional(),
  needsReview: queryBool.optional(),
  gateId: z.uuid().optional(),
  q: z.string().trim().max(32).optional().describe("Plate contains"),
  since: z.iso.datetime({ offset: true }).optional(),
  until: z.iso.datetime({ offset: true }).optional(),
  format: z
    .enum(["json", "csv"])
    .default("json")
    .describe("csv downloads up to 10 000 matching rows"),
});

const CSV_COLUMNS = [
  "captured_at",
  "gate",
  "direction",
  "plate",
  "plate_raw",
  "confidence",
  "match_result",
  "flat",
  "needs_review",
  "review_reason",
] as const;

/** One CSV cell; cells that start like a formula are prefixed so spreadsheets don't run them. */
function csvCell(value: string | number | boolean | null): string {
  let s = value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

defineRoute(
  gateEventsRouter,
  {
    method: "get",
    path: "/gate-events",
    tag: "Gate events",
    summary: "List gate events (newest first), or download them as CSV",
    access: roles("admin", "guard"),
    query: EventQuery,
    responses: {
      200: {
        description: "Events (JSON page, or text/csv when format=csv)",
        schema: pageOf(GateEvent),
      },
    },
  },
  async ({ query, res }) => {
    const where: Prisma.GateEventWhereInput = {
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.matchResult ? { matchResult: query.matchResult } : {}),
      ...(query.needsReview === undefined ? {} : { needsReview: query.needsReview }),
      ...(query.gateId ? { gateId: query.gateId } : {}),
      ...(query.q ? { plateNormalized: { contains: cleanPlate(query.q) } } : {}),
      ...(query.since || query.until
        ? {
            capturedAt: {
              ...(query.since ? { gte: new Date(query.since) } : {}),
              ...(query.until ? { lt: new Date(query.until) } : {}),
            },
          }
        : {}),
    };

    if (query.format === "csv") {
      const rows = await prisma.gateEvent.findMany({
        where,
        include,
        orderBy: { capturedAt: "desc" },
        take: 10_000,
      });
      const lines = rows.map((e) =>
        [
          e.capturedAt.toISOString(),
          e.gate.name,
          e.direction,
          e.plateNormalized,
          e.plateRaw,
          e.confidence,
          e.matchResult,
          e.vehicle ? flatLabel(e.vehicle.flat) : "",
          e.needsReview,
          e.reviewReason,
        ]
          .map(csvCell)
          .join(","),
      );
      res
        .type("text/csv")
        .attachment("gate-events.csv")
        .send([CSV_COLUMNS.join(","), ...lines].join("\n") + "\n");
      return;
    }

    const [rows, total] = await Promise.all([
      prisma.gateEvent.findMany({
        where,
        include,
        orderBy: { capturedAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.gateEvent.count({ where }),
    ]);
    res.json({ items: rows.map(toEvent), total, limit: query.limit, offset: query.offset });
  },
);

// Declared before /gate-events/:id so "review-queue" is not read as an id.
defineRoute(
  gateEventsRouter,
  {
    method: "get",
    path: "/gate-events/review-queue",
    tag: "Gate events",
    summary: "Reads waiting for a guard (oldest first)",
    access: roles("admin", "guard"),
    query: PageQuery,
    responses: { 200: { description: "Open review items", schema: pageOf(GateEvent) } },
  },
  async ({ query, res }) => {
    const where: Prisma.GateEventWhereInput = { needsReview: true, reviewedAt: null };
    const [rows, total] = await Promise.all([
      prisma.gateEvent.findMany({
        where,
        include,
        orderBy: { createdAt: "asc" },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.gateEvent.count({ where }),
    ]);
    res.json({ items: rows.map(toEvent), total, limit: query.limit, offset: query.offset });
  },
);

defineRoute(
  gateEventsRouter,
  {
    method: "get",
    path: "/gate-events/:id",
    tag: "Gate events",
    summary: "Get one gate event",
    access: roles("admin", "guard"),
    params: IdParams,
    responses: {
      200: { description: "Event", schema: GateEvent },
      404: { description: "Not found" },
    },
  },
  async ({ params, res }) => {
    const event = await prisma.gateEvent.findUnique({ where: { id: params.id }, include });
    if (!event) throw notFound("Gate event not found");
    res.json(toEvent(event));
  },
);

defineRoute(
  gateEventsRouter,
  {
    method: "get",
    path: "/gate-events/:id/snapshot",
    tag: "Gate events",
    summary: "Download the camera snapshot of an event",
    access: roles("admin", "guard"),
    params: IdParams,
    responses: {
      200: { description: "The image (JPEG, PNG or WebP)" },
      404: { description: "No snapshot" },
    },
  },
  async ({ params, res }) => {
    const event = await prisma.gateEvent.findUnique({
      where: { id: params.id },
      select: { snapshotKey: true },
    });
    if (!event) throw notFound("Gate event not found");
    const data = event.snapshotKey ? await loadSnapshot(event.snapshotKey) : null;
    if (!event.snapshotKey || !data) throw notFound("This event has no snapshot");
    res
      .set("Cache-Control", "private, max-age=3600")
      .type(contentTypeOf(event.snapshotKey))
      .send(data);
  },
);

// ---------- Guard review ----------

const ReviewBody = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("dismiss") }),
  z.strictObject({
    action: z.literal("correct"),
    plate: z
      .string()
      .trim()
      .min(4)
      .max(32)
      .transform((raw, ctx) => {
        const plate = normalizePlate(raw);
        if (!plate) {
          ctx.addIssue({
            code: "custom",
            message: "Not a valid Indian number plate (e.g. UP16AB1234 or 22BH1234AA)",
          });
          return z.NEVER;
        }
        return plate;
      }),
  }),
]);

defineRoute(
  gateEventsRouter,
  {
    method: "post",
    path: "/gate-events/:id/review",
    tag: "Gate events",
    summary: "Settle a read from the review queue (once)",
    description:
      '`{"action":"correct","plate":"UP16AB1234"}` stores the correction and re-runs matching; `{"action":"dismiss"}` closes it.',
    access: roles("admin", "guard"),
    params: IdParams,
    body: ReviewBody,
    responses: {
      200: { description: "Reviewed", schema: GateEvent },
      404: { description: "Not found" },
      409: { description: "Already reviewed, or never needed review" },
    },
  },
  async ({ params, body, res }) => {
    const guardId = currentUser(res).id;
    try {
      await reviewEvent(params.id, guardId, body);
    } catch (err) {
      if (err instanceof ReviewError) throw new HttpError(err.status, err.message);
      throw err;
    }
    const event = await loadEvent(params.id);
    await announceEvent(event);
    res.json(event);
  },
);
