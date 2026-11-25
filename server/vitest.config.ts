// Tests run against a real Postgres database (vehicle_access_test), never the dev or hosted one.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["tests/setup/global.ts"],
    setupFiles: ["tests/setup/env.ts"],
    // One database, so test files run one after another; each test starts from empty tables.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // Brief §14: services/ coverage must stay at or above 80%.
    coverage: {
      provider: "v8",
      include: ["src/services/**"],
      reporter: ["text-summary"],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
