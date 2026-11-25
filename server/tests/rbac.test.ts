// Every role on every route (brief §10.7): walks the route table, so a new endpoint is
// covered automatically. Allowed roles must get past auth; others get 403; no token gets 401.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Role } from "../generated/prisma/enums.js";
import { prisma } from "../src/db.js";
import { routeTable } from "../src/openapi.js";
import { newDeviceKey } from "../src/routes/devices.js";
import { createUser, makeApi, resetDb, tokenFor } from "./helpers.js";

const ROLES: Role[] = ["admin", "guard", "resident"];
const tokens = {} as Record<Role, string>;
let deviceKey = "";
const api = makeApi();

beforeAll(async () => {
  await resetDb();
  for (const role of ROLES) tokens[role] = await tokenFor((await createUser(role)).id);
  const gate = await prisma.gate.create({ data: { name: "RBAC gate" } });
  const key = newDeviceKey();
  await prisma.device.create({
    data: {
      gateId: gate.id,
      name: "cam",
      direction: "entry",
      apiKeyHash: key.hash,
      apiKeyPrefix: key.prefix,
    },
  });
  deviceKey = key.key;
});

const url = (path: string) => "/api" + path.replace(/:\w+/g, randomUUID());

function call(
  method: "get" | "post" | "patch" | "delete",
  path: string,
  headers: Record<string, string>,
) {
  const client = api.as();
  const req = client[method](url(path));
  for (const [k, v] of Object.entries(headers)) void req.set(k, v);
  return req;
}

describe("route table", () => {
  it("declares every endpoint (sanity check)", () => {
    expect(routeTable.length).toBeGreaterThanOrEqual(40);
  });
});

describe.each(routeTable.filter((r) => r.access.kind === "roles"))("$method $path", (route) => {
  const allowed = route.access.kind === "roles" ? route.access.roles : [];

  it("needs a token (401)", async () => {
    expect((await call(route.method, route.path, {})).status).toBe(401);
  });

  it.each(ROLES)("as %s", async (role) => {
    const res = await call(route.method, route.path, { Authorization: `Bearer ${tokens[role]}` });
    if (allowed.includes(role)) {
      expect([401, 403]).not.toContain(res.status);
    } else {
      expect(res.status).toBe(403);
    }
  });

  it("rejects a camera key (cameras are not people)", async () => {
    expect((await call(route.method, route.path, { "X-Device-Key": deviceKey })).status).toBe(401);
  });
});

describe.each(routeTable.filter((r) => r.access.kind === "device"))(
  "$method $path (camera only)",
  (route) => {
    it("works with a valid device key and refuses everything else", async () => {
      expect((await call(route.method, route.path, { "X-Device-Key": deviceKey })).status).toBe(
        200,
      );
      expect(
        (await call(route.method, route.path, { "X-Device-Key": "vd_not-a-real-key" })).status,
      ).toBe(401);
      expect(
        (await call(route.method, route.path, { Authorization: `Bearer ${tokens.admin}` })).status,
      ).toBe(401);
      expect((await call(route.method, route.path, {})).status).toBe(401);
    });
  },
);

describe.each(routeTable.filter((r) => r.access.kind === "public"))(
  "$method $path (public)",
  (route) => {
    it("does not ask for a token", async () => {
      expect([401, 403]).not.toContain((await call(route.method, route.path, {})).status);
    });
  },
);
