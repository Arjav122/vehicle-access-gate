// One declaration per endpoint gives us three things at once:
//   1. input validation (Zod) for params, query and body,
//   2. access control (public / which roles / camera device),
//   3. the OpenAPI document served at /api/docs.
// `routeTable` lists every endpoint with its access rule, so a test can walk them all.
import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import type { Request, RequestHandler, Response, Router } from "express";
import swaggerUi from "swagger-ui-express";
import { z } from "zod";
import type { Role } from "../generated/prisma/enums.js";
import { parseInput, requireDevice, requireRoles } from "./middleware.js";

export const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Access token from POST /api/auth/login",
});
registry.registerComponent("securitySchemes", "deviceKey", {
  type: "apiKey",
  in: "header",
  name: "X-Device-Key",
  description: "Camera device key (vd_…), shown once when the device is created or its key rotated",
});

// ---------- Shared schemas ----------

export const ErrorSchema = z.object({ detail: z.string() }).meta({ id: "Error" });

export const IdParams = z.object({ id: z.uuid() });

/** `?limit=&offset=` with the brief's defaults (20, max 100). */
export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** `{ items, total, limit, offset }` for any item schema. */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  });
}

/** Query-string boolean: "true" / "false". */
export const queryBool = z.enum(["true", "false"]).transform((v) => v === "true");

// ---------- Route declarations ----------

export type Access = { kind: "public" } | { kind: "roles"; roles: Role[] } | { kind: "device" };

export const PUBLIC: Access = { kind: "public" };
export const DEVICE: Access = { kind: "device" };
export const roles = (...r: Role[]): Access => ({ kind: "roles", roles: r });

type Method = "get" | "post" | "patch" | "delete";

export interface RouteSpec<B extends z.ZodType, Q extends z.ZodType, P extends z.ZodType> {
  method: Method;
  /** Express-style path under /api, e.g. "/flats/:id". */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  access: Access;
  params?: P;
  query?: Q;
  body?: B;
  /** Success responses: status → description (+ schema). Error responses are added for you. */
  responses: Record<number, { description: string; schema?: z.ZodType }>;
}

export interface RouteContext<B, Q, P> {
  body: B;
  query: Q;
  params: P;
  req: Request;
  res: Response;
}

export interface RouteInfo {
  method: Method;
  path: string;
  access: Access;
}

/** Every declared endpoint, for docs and for the "every role on every route" test. */
export const routeTable: RouteInfo[] = [];

export function defineRoute<
  B extends z.ZodType = z.ZodUndefined,
  Q extends z.ZodType = z.ZodUndefined,
  P extends z.ZodType = z.ZodUndefined,
>(
  router: Router,
  spec: RouteSpec<B, Q, P>,
  handler: (ctx: RouteContext<z.output<B>, z.output<Q>, z.output<P>>) => Promise<void> | void,
): void {
  routeTable.push({ method: spec.method, path: spec.path, access: spec.access });
  registerDocs(spec);

  const guards: RequestHandler[] = [];
  if (spec.access.kind === "roles") guards.push(requireRoles(...spec.access.roles));
  if (spec.access.kind === "device") guards.push(requireDevice);

  router[spec.method](spec.path, ...guards, async (req, res) => {
    const ctx = {
      params: spec.params ? parseInput(spec.params, req.params, "path") : undefined,
      query: spec.query ? parseInput(spec.query, req.query, "query") : undefined,
      body: spec.body ? parseInput(spec.body, req.body ?? {}, "body") : undefined,
      req,
      res,
    } as RouteContext<z.output<B>, z.output<Q>, z.output<P>>;
    await handler(ctx);
  });
}

function registerDocs(spec: RouteSpec<z.ZodType, z.ZodType, z.ZodType>): void {
  const error = (description: string) => ({
    description,
    content: { "application/json": { schema: ErrorSchema } },
  });
  const responses: Record<string, unknown> = {};
  for (const [status, r] of Object.entries(spec.responses)) {
    responses[status] = r.schema
      ? { description: r.description, content: { "application/json": { schema: r.schema } } }
      : { description: r.description };
  }
  if (spec.params || spec.query || spec.body) responses["422"] = error("Invalid input");
  if (spec.access.kind !== "public")
    responses["401"] = error("Not signed in, or invalid credentials");
  if (spec.access.kind === "roles")
    responses["403"] = error("Signed in, but this role may not do this");

  const security =
    spec.access.kind === "roles"
      ? [{ bearerAuth: [] }]
      : spec.access.kind === "device"
        ? [{ deviceKey: [] }]
        : [];
  const who =
    spec.access.kind === "roles"
      ? `Roles: ${spec.access.roles.join(", ")}.`
      : spec.access.kind === "device"
        ? "Camera device only."
        : "Public.";

  registry.registerPath({
    method: spec.method,
    path: "/api" + spec.path.replace(/:(\w+)/g, "{$1}"),
    tags: [spec.tag],
    summary: spec.summary,
    description: [who, spec.description].filter(Boolean).join(" "),
    security,
    request: {
      ...(spec.params ? { params: spec.params as z.ZodObject } : {}),
      ...(spec.query ? { query: spec.query as z.ZodObject } : {}),
      ...(spec.body ? { body: { content: { "application/json": { schema: spec.body } } } } : {}),
    },
    responses: responses as never,
  });
}

// ---------- Document + Swagger UI ----------

export function openApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Vehicle Access API",
      version: "0.1.0",
      description:
        "Gate and visitor management for housing societies. Sign in with POST /api/auth/login, then click Authorize and paste the accessToken.",
    },
  });
}

/** Mount /api/openapi.json and the Swagger UI at /api/docs. */
export function mountDocs(router: Router): void {
  const doc = openApiDocument();
  router.get("/openapi.json", (_req, res) => {
    res.json(doc);
  });
  router.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(doc, { swaggerOptions: { persistAuthorization: true } }),
  );
}
