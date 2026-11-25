// Liveness and readiness probes (public).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { HttpError } from "../middleware.js";
import { defineRoute, PUBLIC } from "../openapi.js";

export const systemRouter = Router();

const Status = z.object({ status: z.literal("ok") }).meta({ id: "Status" });

defineRoute(
  systemRouter,
  {
    method: "get",
    path: "/health",
    tag: "System",
    summary: "Liveness: the process is up",
    access: PUBLIC,
    responses: { 200: { description: "Alive", schema: Status } },
  },
  ({ res }) => {
    res.json({ status: "ok" });
  },
);

defineRoute(
  systemRouter,
  {
    method: "get",
    path: "/ready",
    tag: "System",
    summary: "Readiness: the database answers",
    access: PUBLIC,
    responses: {
      200: { description: "Ready", schema: Status },
      503: { description: "Database unreachable" },
    },
  },
  async ({ res }) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new HttpError(503, "Database unreachable");
    }
    res.json({ status: "ok" });
  },
);
