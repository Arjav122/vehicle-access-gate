// Society settings: time limits, approval timeout, OCR confidence threshold, retention.
// Admins edit (audited); guards can read. No saved row yet → the config defaults apply.
import { Router } from "express";
import { z } from "zod";
import { prisma, withTx } from "../db.js";
import { currentUser } from "../middleware.js";
import { defineRoute, roles } from "../openapi.js";
import { recordAudit } from "../services/audit.js";
import { effectiveSettings } from "../services/visits.js";

export const settingsRouter = Router();

const Settings = z
  .object({
    guestMinutes: z.number().int(),
    deliveryMinutes: z.number().int(),
    cabMinutes: z.number().int(),
    serviceMinutes: z.number().int(),
    approvalTimeoutSeconds: z.number().int(),
    confidenceThreshold: z.number(),
    visitorRetentionDays: z.number().int(),
  })
  .meta({ id: "Settings" });

const minutes = z
  .number()
  .int()
  .min(1)
  .max(7 * 24 * 60);

defineRoute(
  settingsRouter,
  {
    method: "get",
    path: "/settings",
    tag: "Settings",
    summary: "Society settings in effect",
    access: roles("admin", "guard"),
    responses: { 200: { description: "Settings", schema: Settings } },
  },
  async ({ res }) => {
    res.json(await effectiveSettings(prisma));
  },
);

defineRoute(
  settingsRouter,
  {
    method: "patch",
    path: "/settings",
    tag: "Settings",
    summary: "Change society settings",
    access: roles("admin"),
    body: z
      .strictObject({
        guestMinutes: minutes.optional(),
        deliveryMinutes: minutes.optional(),
        cabMinutes: minutes.optional(),
        serviceMinutes: minutes.optional(),
        approvalTimeoutSeconds: z.number().int().min(30).max(3600).optional(),
        confidenceThreshold: z.number().min(0).max(1).optional(),
        visitorRetentionDays: z.number().int().min(1).max(3650).optional(),
      })
      .refine((v) => Object.keys(v).length > 0, "Send at least one field to change"),
    responses: { 200: { description: "Updated", schema: Settings } },
  },
  async ({ body, res }) => {
    const actorId = currentUser(res).id;
    const after = await withTx(async (tx) => {
      const before = await effectiveSettings(tx);
      const next = { ...before, ...body };
      await tx.societySettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...next },
        update: next,
      });
      await recordAudit(tx, {
        actorId,
        action: "settings.update",
        entityType: "settings",
        entityId: "1",
        before: { ...before },
        after: { ...next },
      });
      return next;
    });
    res.json(after);
  },
);
