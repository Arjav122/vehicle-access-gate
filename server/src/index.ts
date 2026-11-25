// App setup: middleware order, routes, docs, errors. Later phases add Socket.io and jobs here.
import { pathToFileURL } from "node:url";
import express from "express";
import { config } from "./config.js";
import { prisma } from "./db.js";
import {
  corsPolicy,
  errorHandler,
  logger,
  loginRateLimits,
  notFoundHandler,
  requestLogger,
  securityHeaders,
} from "./middleware.js";
import { mountDocs } from "./openapi.js";
import { auditLogsRouter } from "./routes/auditLogs.js";
import { authRouter } from "./routes/auth.js";
import { devicesRouter } from "./routes/devices.js";
import { flatsRouter } from "./routes/flats.js";
import { gatesRouter } from "./routes/gates.js";
import { guardsRouter } from "./routes/guards.js";
import { residentsRouter } from "./routes/residents.js";
import { systemRouter } from "./routes/system.js";
import { vehiclesRouter } from "./routes/vehicles.js";
import { watchlistRouter } from "./routes/watchlist.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestLogger);
  app.use(securityHeaders);
  app.use(corsPolicy);
  app.use(express.json({ limit: config.MAX_REQUEST_BYTES }));

  app.use("/api/auth/login", ...loginRateLimits());

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
    auditLogsRouter,
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
const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  const server = createApp().listen(config.PORT, config.HOST, () => {
    logger.info(
      `API listening on http://${config.HOST}:${String(config.PORT)} (docs at /api/docs)`,
    );
  });
  const shutdown = () => {
    server.close(() => void prisma.$disconnect().finally(() => process.exit(0)));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
