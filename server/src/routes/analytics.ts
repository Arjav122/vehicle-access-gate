// Dashboard numbers (admin) and who is inside right now (admin + guard). IST time zone.
import { Router } from "express";
import { z } from "zod";
import { defineRoute, roles } from "../openapi.js";
import { inside, overview } from "../services/analytics.js";

export const analyticsRouter = Router();

const Overview = z
  .object({
    days: z.number().int(),
    since: z.iso.datetime(),
    totals: z.object({
      gateEvents: z.number().int(),
      residentEntries: z.number().int(),
      visits: z.number().int(),
      completedVisits: z.number().int(),
    }),
    averageVisitMinutes: z.number().nullable(),
    overstayRate: z.number().nullable().describe("0–1, of visits that entered in the window"),
    busiestHours: z.array(z.object({ hour: z.number().int(), entries: z.number().int() })),
    daily: z.array(
      z.object({
        date: z.string().describe("IST date, YYYY-MM-DD"),
        residentEntries: z.number().int(),
        visits: z.number().int(),
      }),
    ),
    byCategory: z.array(z.object({ category: z.string(), visits: z.number().int() })),
    frequentVisitors: z.array(
      z.object({
        plate: z.string(),
        visits: z.number().int(),
        lastVisitAt: z.iso.datetime(),
        flatLabel: z.string(),
      }),
    ),
  })
  .meta({ id: "AnalyticsOverview" });

const Inside = z
  .object({
    visitors: z.array(
      z.object({
        visitId: z.uuid(),
        plate: z.string().nullable(),
        visitorName: z.string().nullable(),
        flatLabel: z.string(),
        category: z.string(),
        status: z.string(),
        enteredAt: z.iso.datetime().nullable(),
        expectedExitAt: z.iso.datetime().nullable(),
      }),
    ),
    residentVehicles: z.number().int(),
    total: z.number().int(),
  })
  .meta({ id: "VehiclesInside" });

defineRoute(
  analyticsRouter,
  {
    method: "get",
    path: "/analytics/overview",
    tag: "Analytics",
    summary: "Traffic, busiest hours, visit duration, overstay rate, frequent visitors",
    access: roles("admin"),
    query: z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }),
    responses: { 200: { description: "Overview", schema: Overview } },
  },
  async ({ query, res }) => {
    res.json(await overview(query.days));
  },
);

defineRoute(
  analyticsRouter,
  {
    method: "get",
    path: "/analytics/inside",
    tag: "Analytics",
    summary: "Vehicles inside right now (visitors listed, resident cars counted)",
    access: roles("admin", "guard"),
    responses: { 200: { description: "Inside", schema: Inside } },
  },
  async ({ res }) => {
    res.json(await inside());
  },
);
