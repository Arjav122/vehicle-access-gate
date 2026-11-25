// Demo mode: one-click logins for the public demo. Only exists when DEMO_MODE=true; otherwise
// every path here answers 404 as if it were not there. The demo password is meant to be public
// in demo mode (the landing page shows "Try demo as Guard"), never in a real society.
// POST /demo/reset and the nightly reset come with the simulator in Phase 7.
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { notFound } from "../middleware.js";
import { defineRoute, PUBLIC } from "../openapi.js";

export const demoRouter = Router();

export const DEMO_ACCOUNTS = [
  { role: "guard", email: "guard@example.com", label: "Ramesh Kumar, Main gate guard" },
  { role: "resident", email: "resident@example.com", label: "Priya Sharma, flat A-101" },
  { role: "admin", email: "admin@example.com", label: "Rakesh Khanna, society secretary" },
] as const;

const Demo = z
  .object({
    society: z.string(),
    password: z.string(),
    accounts: z.array(
      z.object({
        role: z.enum(["admin", "guard", "resident"]),
        email: z.string(),
        label: z.string(),
      }),
    ),
  })
  .meta({ id: "DemoInfo" });

defineRoute(
  demoRouter,
  {
    method: "get",
    path: "/demo",
    tag: "Demo",
    summary: "Demo logins (only when DEMO_MODE=true, else 404)",
    access: PUBLIC,
    responses: { 200: { description: "Demo accounts", schema: Demo }, 404: { description: "Off" } },
  },
  ({ res }) => {
    if (!config.DEMO_MODE || !config.DEMO_PASSWORD) throw notFound("Not found");
    res.json({
      society: "Green Valley Residency, Greater Noida",
      password: config.DEMO_PASSWORD,
      accounts: DEMO_ACCOUNTS,
    });
  },
);
