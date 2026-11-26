// Demo mode: one-click logins and a reset for the public demo. Only exists when DEMO_MODE=true;
// otherwise every path here answers 404 as if it were not there. The demo password is meant to
// be public in demo mode (the landing page shows "Try demo as Guard"), never in a real society.
//
// A reset empties the database and seeds the demo society again (about a minute and a half with
// history). It runs in the background: the request answers 202 at once, everybody is signed out
// (their accounts are re-created), and the simulator notices its keys stopped working and
// starts over. The same reset runs nightly at 04:00 IST (jobs.ts).
import { Router } from "express";
import { z } from "zod";
import { emptyDatabase, seedSociety } from "../../prisma/seed.js";
import { config } from "../config.js";
import { HttpError, logger, notFound } from "../middleware.js";
import { defineRoute, PUBLIC, roles } from "../openapi.js";

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
    resetting: z.boolean().describe("A demo reset is running; sign in again when it is false"),
  })
  .meta({ id: "DemoInfo" });

// One reset at a time in this process (the only API process, D12).
let running: Promise<void> | null = null;

export const demoResetRunning = (): boolean => running !== null;

/**
 * Empty the database and seed the demo society again. Returns false (and does nothing) when a
 * reset is already running. Resolves when the new data is in place.
 */
export async function runDemoReset(opts: { history?: boolean } = {}): Promise<boolean> {
  if (running) return false;
  const started = Date.now();
  running = (async () => {
    const tables = await emptyDatabase();
    const summary = await seedSociety({ history: opts.history ?? true });
    logger.info(
      { tables, visits: summary.history?.visits ?? 0, ms: Date.now() - started },
      "demo reset done",
    );
  })();
  try {
    await running;
    return true;
  } finally {
    running = null;
  }
}

const demoOn = () => config.DEMO_MODE && Boolean(config.DEMO_PASSWORD);

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
    if (!demoOn()) throw notFound("Not found");
    res.json({
      society: "Green Valley Residency, Greater Noida",
      password: config.DEMO_PASSWORD,
      accounts: DEMO_ACCOUNTS,
      resetting: demoResetRunning(),
    });
  },
);

defineRoute(
  demoRouter,
  {
    method: "post",
    path: "/demo/reset",
    tag: "Demo",
    summary: "Reset the demo data (admin, demo mode only). Runs in the background.",
    description:
      "Answers 202 at once; the reset takes about a minute and a half and signs everybody out.",
    access: roles("admin"),
    body: z.strictObject({
      history: z
        .boolean()
        .default(true)
        .describe("false: people, flats, cars and cameras only (seconds instead of ~90 s)"),
    }),
    responses: {
      202: { description: "Reset started", schema: z.object({ status: z.literal("started") }) },
      404: { description: "Demo mode is off" },
      409: { description: "A reset is already running" },
    },
  },
  ({ body, res }) => {
    if (!demoOn()) throw notFound("Not found");
    if (demoResetRunning()) throw new HttpError(409, "A demo reset is already running");
    runDemoReset({ history: body.history }).catch((err: unknown) => {
      logger.error({ err }, "demo reset failed");
    });
    res.status(202).json({ status: "started" });
  },
);
