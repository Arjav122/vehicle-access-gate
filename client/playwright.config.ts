// Playwright runs against the real stack (docker compose up + npm run seed), never mocks.
// Phase 6: `npm run screenshots` captures every main screen into docs/assets/.
// Phase 7 adds the three end-to-end journeys here.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
});
