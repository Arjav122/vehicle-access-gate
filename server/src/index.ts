// App setup: middleware order, routes, docs, errors; Socket.io and scheduled jobs at start-up.
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import express from "express";
import { config } from "./config.js";
import { prisma } from "./db.js";
import {
  corsPolicy,
  deviceRateLimit,
  errorHandler,
  logger,
  loginRateLimits,
  notFoundHandler,
  requestLogger,
  securityHeaders,
} from "./middleware.js";
import { startJobs } from "./jobs.js";
import { mountDocs, openApiDocument } from "./openapi.js";
import { initRealtime } from "./realtime.js";
import { alertsRouter } from "./routes/alerts.js";
import { analyticsRouter } from "./routes/analytics.js";
import { approvalsRouter } from "./routes/approvals.js";
import { auditLogsRouter } from "./routes/auditLogs.js";
import { authRouter } from "./routes/auth.js";
import { demoRouter } from "./routes/demo.js";
import { devicesRouter } from "./routes/devices.js";
import { escalationsRouter } from "./routes/escalations.js";
import { flatsRouter } from "./routes/flats.js";
import { gateEventsRouter } from "./routes/gateEvents.js";
import { gatesRouter } from "./routes/gates.js";
import { guardsRouter } from "./routes/guards.js";
import { guestPassesRouter } from "./routes/guestPasses.js";
import { reconciliationRouter } from "./routes/reconciliation.js";
import { residentsRouter } from "./routes/residents.js";
import { settingsRouter } from "./routes/settings.js";
import { systemRouter } from "./routes/system.js";
import { vehiclesRouter } from "./routes/vehicles.js";
import { visitsRouter } from "./routes/visits.js";
import { watchlistRouter } from "./routes/watchlist.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestLogger);
  app.use(securityHeaders);
  app.use(corsPolicy);
  app.use(express.json({ limit: config.MAX_REQUEST_BYTES }));

  app.use("/api/auth/login", ...loginRateLimits());
  app.post("/api/gate-events", deviceRateLimit());

  const api = express.Router();
  for (const router of [
    systemRouter,
    authRouter,
    flatsRouter,
    residentsRouter,
    guardsRouter,
    vehiclesRouter,
    gatesRouter,
    devicesRouter,
    watchlistRouter,
    gateEventsRouter,
    alertsRouter,
    visitsRouter,
    approvalsRouter,
    guestPassesRouter,
    settingsRouter,
    escalationsRouter,
    reconciliationRouter,
    auditLogsRouter,
    analyticsRouter,
    demoRouter,
  ]) {
    api.use(router);
  }
  mountDocs(api);
  app.use("/api", api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

// Start listening only when run directly (`tsx src/index.ts`), not when a test imports this file.
// `--write-openapi <file>` writes the API document instead (npm run openapi → client/openapi.json).
const entryPath = process.argv[1];
const isEntry = entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href;
const openApiOut = process.argv[2] === "--write-openapi" ? process.argv[3] : undefined;
if (isEntry && openApiOut) {
  createApp(); // registers every route's schema
  writeFileSync(openApiOut, JSON.stringify(openApiDocument(), null, 2) + "\n");
  logger.info(`Wrote ${openApiOut}`);
  await prisma.$disconnect();
} else if (isEntry) {
  const server = createServer(createApp());
  initRealtime(server);
  const jobs = config.RUN_JOBS ? startJobs() : null;
  server.listen(config.PORT, config.HOST, () => {
    logger.info(
      `API listening on http://${config.HOST}:${String(config.PORT)} (docs at /api/docs, real time at /socket.io)`,
    );
  });
  const shutdown = () => {
    jobs?.stop();
    server.close(() => void prisma.$disconnect().finally(() => process.exit(0)));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
