// Express middleware: request ids + logging, security headers, CORS, rate limits,
// people auth (Bearer JWT), camera auth (X-Device-Key), roles, input parsing, errors.
import { createHash, randomUUID } from "node:crypto";
import cors from "cors";
import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { pino } from "pino";
import { pinoHttp } from "pino-http";
import { z } from "zod";
import { config } from "./config.js";
import { describeDbError, prisma } from "./db.js";
import type { LaneDirection, Role } from "../generated/prisma/enums.js";
import { verifyAccessToken } from "./services/auth.js";

// ---------- Errors ----------

/** An error with an HTTP status. The error handler sends it as `{ "detail": message }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what);

// ---------- Who is calling ----------

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

export interface AuthDevice {
  id: string;
  name: string;
  gateId: string;
  direction: LaneDirection;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      user?: AuthUser;
      device?: AuthDevice;
    }
  }
}

/** The signed-in user; only valid on routes guarded by requireRoles. */
export function currentUser(res: { locals: Express.Locals }): AuthUser {
  if (!res.locals.user) throw new HttpError(401, "Not signed in");
  return res.locals.user;
}

/** The calling camera; only valid on routes guarded by requireDevice. */
export function currentDevice(res: { locals: Express.Locals }): AuthDevice {
  if (!res.locals.device) throw new HttpError(401, "Missing or invalid device key");
  return res.locals.device;
}

// ---------- Logging and request ids ----------

export const logger = pino({
  level: config.LOG_LEVEL ?? (config.NODE_ENV === "test" ? "silent" : "info"),
  redact: ["req.headers.authorization", "req.headers['x-device-key']", "req.headers.cookie"],
});

const SANE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Keep the caller's X-Request-ID if it looks safe, otherwise make one; echo it back. */
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers["x-request-id"];
    const id =
      typeof incoming === "string" && SANE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-ID", id);
    return id;
  },
  // Keep each line short: what was asked, and how it ended.
  serializers: {
    req: (req: { id: unknown; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
});

// ---------- Security headers, CORS ----------

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    // Dev runs on plain http://127.0.0.1, where "upgrade to https" would break the docs page.
    directives: { upgradeInsecureRequests: config.NODE_ENV === "production" ? [] : null },
  },
});

/** Only listed browser origins may call the API from another origin (none needed in prod). */
export const corsPolicy = cors({
  origin: (origin, callback) => {
    callback(null, origin === undefined || config.CORS_ORIGINS.includes(origin));
  },
  exposedHeaders: ["X-Request-ID", "Retry-After"],
});

// ---------- Rate limits ----------

function limiter(limit: number, message: string, key?: (req: Request) => string): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...(key ? { keyGenerator: key } : {}),
    handler: (_req, res, _next, options) => {
      res.setHeader("Retry-After", String(Math.ceil(options.windowMs / 1000)));
      res.status(429).json({ detail: message });
    },
  });
}

/**
 * Login limits: per IP and per account (email). Built per app instance so tests start fresh.
 * In-memory counters are fine for one server instance (docs/decisions.md D11).
 */
export function loginRateLimits(): RequestHandler[] {
  const message = "Too many login attempts. Try again in a minute.";
  return [
    limiter(config.LOGIN_RATE_LIMIT_PER_IP, message),
    limiter(config.LOGIN_RATE_LIMIT_PER_ACCOUNT, message, (req) => {
      const body: unknown = req.body;
      const email =
        typeof body === "object" &&
        body !== null &&
        "email" in body &&
        typeof body.email === "string"
          ? body.email.trim().toLowerCase()
          : "";
      return `account:${email}`;
    }),
  ];
}

// ---------- People: Bearer access token ----------

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

/**
 * Require a valid access token, then load the user from the database on every request,
 * so deactivating someone takes effect immediately (not when their token expires).
 */
export function requireRoles(...roles: Role[]): RequestHandler {
  return async (req, res, next) => {
    const token = bearerToken(req);
    if (!token) throw new HttpError(401, "Not signed in", { "WWW-Authenticate": "Bearer" });

    const userId = await verifyAccessToken(token);
    const user = userId
      ? await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, fullName: true, role: true, isActive: true },
        })
      : null;
    if (!user?.isActive) {
      throw new HttpError(401, "Session expired or invalid. Sign in again.", {
        "WWW-Authenticate": "Bearer",
      });
    }
    if (!roles.includes(user.role)) throw new HttpError(403, "You don't have access to this");

    res.locals.user = { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
    next();
  };
}

// ---------- Cameras: X-Device-Key ----------

export const hashDeviceKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Authenticate a camera by its key. Writes lastSeenAt at most once a minute. */
export const requireDevice: RequestHandler = async (req, res, next) => {
  const key = req.headers["x-device-key"];
  if (typeof key !== "string" || !key.startsWith("vd_")) {
    throw new HttpError(401, "Missing or invalid device key");
  }
  const device = await prisma.device.findUnique({
    where: { apiKeyHash: hashDeviceKey(key) },
    select: {
      id: true,
      name: true,
      gateId: true,
      direction: true,
      isActive: true,
      gate: { select: { isActive: true } },
    },
  });
  if (!device?.isActive || !device.gate.isActive)
    throw new HttpError(401, "Missing or invalid device key");

  const now = new Date();
  await prisma.device.updateMany({
    where: {
      id: device.id,
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - 60_000) } }],
    },
    data: { lastSeenAt: now },
  });

  res.locals.device = {
    id: device.id,
    name: device.name,
    gateId: device.gateId,
    direction: device.direction,
  };
  next();
};

// ---------- Input parsing ----------

/** Parse untrusted input with a Zod schema; any problem becomes a 422 with a readable message. */
export function parseInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
  where: string,
): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.length ? `${first.path.join(".")}: ` : "";
    throw new HttpError(422, `Invalid ${where}: ${path}${first?.message ?? "invalid input"}`);
  }
  return result.data;
}

// ---------- Errors and 404 ----------

export const notFoundHandler: RequestHandler = () => {
  throw notFound();
};

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  if (err instanceof HttpError) {
    res.set(err.headers).status(err.status).json({ detail: err.message });
    return;
  }
  // Body parser errors (bad JSON, too large) carry a status.
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof err.status === "number"
  ) {
    const status = err.status;
    const detail = status === 413 ? "Request body is too large" : "Malformed request body";
    res.status(status === 413 ? 413 : 422).json({ detail });
    return;
  }
  const db = describeDbError(err);
  if (db) {
    res.status(db.status).json({ detail: db.detail });
    return;
  }
  req.log.error({ err }, "unhandled error");
  res.status(500).json({ detail: "Something went wrong on our side" });
};
