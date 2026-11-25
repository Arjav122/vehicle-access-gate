import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In dev, the browser calls same-origin /api and /socket.io; Vite forwards them to the Node API.
// Docker compose sets VITE_DEV_API_TARGET=http://server:4000.
const apiTarget = process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": apiTarget,
      "/socket.io": { target: apiTarget, ws: true },
    },
    // File-change events do not cross a Windows -> Docker bind mount; poll inside the container.
    watch: process.env.VITE_USE_POLLING === "true" ? { usePolling: true, interval: 500 } : null,
  },
  test: {
    environment: "jsdom",
  },
});
