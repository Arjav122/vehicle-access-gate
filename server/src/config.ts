// All settings come from environment variables, parsed and checked once at startup.
// Every variable is documented in the repo-root .env.example.
import { z } from "zod";

export const DEFAULT_JWT_SECRET = "dev-only-change-me";

/** An unset or empty env var means "use the default". */
const env = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema);
const int = (fallback: number) => env(z.coerce.number().int().positive().default(fallback));
const bool = (fallback: boolean) =>
  env(
    z
      .enum(["true", "false"])
      .default(fallback ? "true" : "false")
      .transform((v) => v === "true"),
  );

const schema = z
  .object({
    NODE_ENV: env(z.enum(["development", "test", "production"]).default("development")),
    HOST: env(z.string().default("127.0.0.1")),
    PORT: int(4000),
    LOG_LEVEL: env(
      z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
    ),

    DATABASE_URL: z.string({ error: "DATABASE_URL is required" }).min(1),

    JWT_SECRET: env(z.string().default(DEFAULT_JWT_SECRET)),
    ACCESS_TOKEN_MINUTES: int(15),
    REFRESH_TOKEN_DAYS: int(7),

    CORS_ORIGINS: env(
      z
        .string()
        .default("")
        .transform((s) =>
          s
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean),
        ),
    ),
    MAX_REQUEST_BYTES: int(1_048_576),
    LOGIN_RATE_LIMIT_PER_IP: int(20),
    LOGIN_RATE_LIMIT_PER_ACCOUNT: int(10),
    DEVICE_RATE_LIMIT: int(600),

    PLATE_CONFIDENCE_THRESHOLD: env(z.coerce.number().min(0).max(1).default(0.8)),
    PLATE_FUZZY_MAX_DISTANCE: env(z.coerce.number().int().min(0).max(2).default(1)),
    GATE_EVENT_COOLDOWN_SECONDS: int(30),
    GATE_EVENT_MAX_CLOCK_SKEW_SECONDS: int(300),

    VISIT_LIMIT_GUEST_MINUTES: int(240),
    VISIT_LIMIT_DELIVERY_MINUTES: int(20),
    VISIT_LIMIT_CAB_MINUTES: int(10),
    VISIT_LIMIT_SERVICE_MINUTES: int(120),
    APPROVAL_TIMEOUT_SECONDS: int(180),
    OVERSTAY_REMINDER_MINUTES: int(30),
    OVERSTAY_ESCALATION_MINUTES: int(60),
    RECONCILIATION_STALE_HOURS: int(24),
    VISITOR_RETENTION_DAYS: int(90),

    PUBLIC_BASE_URL: env(z.string().default("http://127.0.0.1:5173")),
    RUN_JOBS: bool(true),

    DEMO_MODE: bool(false),
    DEMO_PASSWORD: env(z.string().optional()),
  })
  .superRefine((c, ctx) => {
    if (
      c.NODE_ENV === "production" &&
      (c.JWT_SECRET === DEFAULT_JWT_SECRET || c.JWT_SECRET.length < 32)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_SECRET"],
        message: "Set a random JWT_SECRET of at least 32 characters in production",
      });
    }
  });

export type Config = z.infer<typeof schema>;

/** Parse an environment; throws one readable error listing every problem. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export const config = loadConfig();
