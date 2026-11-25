// Phase 0 placeholder: the smallest Express app that proves the toolchain, Docker and CI work.
// Phase 1 replaces this with the real setup (Zod config, pino, middleware, routes, socket, jobs).
import { pathToFileURL } from "node:url";
import express from "express";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}

// Start listening only when run directly (`tsx src/index.ts`), not when a test imports this file.
const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  const port = Number(process.env.PORT ?? 4000);
  // 127.0.0.1 by default so a local run is not exposed to the network; Docker sets HOST=0.0.0.0.
  const host = process.env.HOST ?? "127.0.0.1";
  createApp().listen(port, host, () => {
    console.log(`API listening on http://${host}:${String(port)}`);
  });
}
