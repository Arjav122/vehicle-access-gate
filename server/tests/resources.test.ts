// Admin resources: CRUD rules, conflicts, deactivation, camera keys, audit log.
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { adminApi, createUser, makeApi, resetDb, tokenFor } from "./helpers.js";

beforeEach(resetDb);

describe("flats", () => {
  it("creates, lists with search, updates and deletes", async () => {
    const { asAdmin } = await adminApi();
    const created = await asAdmin.post("/api/flats", { block: "b", number: "402", floor: 4 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ block: "B", number: "402", label: "B-402" });
    await asAdmin.post("/api/flats", { block: "C", number: "402", floor: 4 });
    await asAdmin.post("/api/flats", { block: "B", number: "101", floor: 1 });

    expect((await asAdmin.get("/api/flats?q=B-402")).body.total).toBe(1);
    expect((await asAdmin.get("/api/flats?q=402")).body.total).toBe(2);
    expect((await asAdmin.get("/api/flats?block=B")).body.total).toBe(2);

    const page = await asAdmin.get("/api/flats?limit=2&offset=0");
    expect(page.body).toMatchObject({ total: 3, limit: 2, offset: 0 });
    expect(page.body.items).toHaveLength(2);

    const updated = await asAdmin.patch(`/api/flats/${String(created.body.id)}`, { floor: 5 });
    expect(updated.body.floor).toBe(5);
    expect((await asAdmin.delete(`/api/flats/${String(created.body.id)}`)).status).toBe(204);
    expect((await asAdmin.get(`/api/flats/${String(created.body.id)}`)).status).toBe(404);
  });

  it("rejects duplicates (409), bad input (422), empty updates (422) and limit > 100 (422)", async () => {
    const { asAdmin } = await adminApi();
    await asAdmin.post("/api/flats", { block: "A", number: "101", floor: 1 });
    const dup = await asAdmin.post("/api/flats", { block: "A", number: "101", floor: 1 });
    expect(dup.status).toBe(409);
    expect(dup.body.detail).toBe("This flat already exists");

    expect(
      (await asAdmin.post("/api/flats", { block: "A1", number: "101", floor: 1 })).status,
    ).toBe(422);
    expect(
      (await asAdmin.post("/api/flats", { block: "A", number: "101", floor: 1, extra: 1 })).status,
    ).toBe(422);
    const flat = await prisma.flat.findFirstOrThrow();
    expect((await asAdmin.patch(`/api/flats/${flat.id}`, {})).status).toBe(422);
    expect((await asAdmin.get("/api/flats?limit=101")).status).toBe(422);
  });

  it("refuses to delete a flat that still has residents (409)", async () => {
    const { asAdmin } = await adminApi();
    const flat = await prisma.flat.create({ data: { block: "D", number: "502", floor: 5 } });
    await createUser("resident", { flatId: flat.id });
    const res = await asAdmin.delete(`/api/flats/${flat.id}`);
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/still in use/);
  });
});

describe("vehicles", () => {
  it("cleans and validates plates, and refuses duplicates", async () => {
    const { asAdmin } = await adminApi();
    const flat = await prisma.flat.create({ data: { block: "A", number: "101", floor: 1 } });

    const created = await asAdmin.post("/api/vehicles", {
      flatId: flat.id,
      plate: "up16 ab-1234",
      vehicleType: "car",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      plate: "UP16AB1234",
      plateRaw: "up16 ab-1234",
      flatLabel: "A-101",
    });

    const dup = await asAdmin.post("/api/vehicles", {
      flatId: flat.id,
      plate: "UP 16 AB 1234",
      vehicleType: "car",
    });
    expect(dup.status).toBe(409);
    expect(dup.body.detail).toBe("A vehicle with this plate is already registered");

    const bad = await asAdmin.post("/api/vehicles", {
      flatId: flat.id,
      plate: "XX16AB1234",
      vehicleType: "car",
    });
    expect(bad.status).toBe(422);
    expect(bad.body.detail).toMatch(/Not a valid Indian number plate/);

    expect((await asAdmin.get("/api/vehicles?q=ab 12")).body.total).toBe(1);
  });

  it("guards can look vehicles up but not change them", async () => {
    const { as } = await adminApi();
    const guard = as(await tokenFor((await createUser("guard")).id));
    expect((await guard.get("/api/vehicles")).status).toBe(200);
    expect((await guard.post("/api/vehicles", {})).status).toBe(403);
  });
});

describe("residents", () => {
  it("creates a login that works, and allows one primary contact per flat", async () => {
    const { asAdmin, as } = await adminApi();
    const flat = await prisma.flat.create({ data: { block: "B", number: "402", floor: 4 } });
    const body = {
      fullName: "Priya Sharma",
      password: "long-enough-pw",
      flatId: flat.id,
      residentType: "owner",
    };

    const first = await asAdmin.post("/api/residents", {
      ...body,
      email: "Priya@Example.com",
      isPrimaryContact: true,
    });
    expect(first.status).toBe(201);
    expect(first.body.user.email).toBe("priya@example.com");

    const second = await asAdmin.post("/api/residents", {
      ...body,
      email: "rahul@example.com",
      isPrimaryContact: true,
    });
    expect(second.status).toBe(409);
    expect(second.body.detail).toBe("This flat already has a primary contact");

    const sameEmail = await asAdmin.post("/api/residents", { ...body, email: "priya@example.com" });
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.detail).toBe("A user with this email already exists");

    const login = await as().post("/api/auth/login", {
      email: "priya@example.com",
      password: "long-enough-pw",
    });
    expect(login.status).toBe(200);
  });

  it("deleting deactivates (never deletes) and signs the person out", async () => {
    const { asAdmin, as } = await adminApi();
    const flat = await prisma.flat.create({ data: { block: "C", number: "201", floor: 2 } });
    const created = await asAdmin.post("/api/residents", {
      email: "amit@example.com",
      fullName: "Amit Verma",
      password: "long-enough-pw",
      flatId: flat.id,
      residentType: "tenant",
    });
    const login = await as().post("/api/auth/login", {
      email: "amit@example.com",
      password: "long-enough-pw",
    });

    expect((await asAdmin.delete(`/api/residents/${String(created.body.id)}`)).status).toBe(204);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { email: "amit@example.com" } }),
    ).toMatchObject({ isActive: false });
    expect((await as(login.body.accessToken).get("/api/me")).status).toBe(401);
    expect(
      (await as().post("/api/auth/refresh", { refreshToken: login.body.refreshToken })).status,
    ).toBe(401);
  });
});

describe("guards", () => {
  it("creates and deactivates guards", async () => {
    const { asAdmin } = await adminApi();
    const created = await asAdmin.post("/api/guards", {
      email: "ramesh@example.com",
      fullName: "Ramesh Kumar",
      password: "long-enough-pw",
    });
    expect(created.status).toBe(201);
    expect((await asAdmin.get("/api/guards?isActive=true")).body.total).toBe(1);
    await asAdmin.delete(`/api/guards/${String(created.body.id)}`);
    expect((await asAdmin.get("/api/guards?isActive=true")).body.total).toBe(0);
    expect((await asAdmin.get(`/api/guards/${String(created.body.id)}`)).body.isActive).toBe(false);
  });
});

describe("gates and devices", () => {
  it("returns a device key once, stores only its hash, and rotating it kills the old key", async () => {
    const { asAdmin } = await adminApi();
    const gate = await asAdmin.post("/api/gates", { name: "Main gate" });
    const created = await asAdmin.post("/api/devices", {
      gateId: gate.body.id,
      name: "Entry cam",
      direction: "entry",
    });

    expect(created.status).toBe(201);
    const key = created.body.apiKey as string;
    expect(key).toMatch(/^vd_[A-Za-z0-9_-]{43}$/);
    expect(created.body.apiKeyPrefix).toBe(key.slice(0, 11));
    expect((await asAdmin.get(`/api/devices/${String(created.body.id)}`)).body).not.toHaveProperty(
      "apiKey",
    );
    const stored = await prisma.device.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.apiKeyHash).not.toContain(key);

    const me = await makeApi().as().get("/api/devices/me").set("X-Device-Key", key);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ name: "Entry cam", direction: "entry", gateId: gate.body.id });
    expect(
      (await prisma.device.findUniqueOrThrow({ where: { id: created.body.id } })).lastSeenAt,
    ).not.toBeNull();

    const rotated = await asAdmin.post(`/api/devices/${String(created.body.id)}/rotate-key`);
    expect(rotated.body.apiKey).not.toBe(key);
    expect((await makeApi().as().get("/api/devices/me").set("X-Device-Key", key)).status).toBe(401);
    expect(
      (await makeApi().as().get("/api/devices/me").set("X-Device-Key", rotated.body.apiKey)).status,
    ).toBe(200);
  });

  it("a deactivated device or gate stops authenticating; a gate with devices cannot be deleted", async () => {
    const { asAdmin } = await adminApi();
    const gate = await asAdmin.post("/api/gates", { name: "Service gate" });
    const device = await asAdmin.post("/api/devices", {
      gateId: gate.body.id,
      name: "Exit cam",
      direction: "exit",
    });
    const cam = () => makeApi().as().get("/api/devices/me").set("X-Device-Key", device.body.apiKey);

    expect((await asAdmin.delete(`/api/gates/${String(gate.body.id)}`)).status).toBe(409);

    await asAdmin.patch(`/api/gates/${String(gate.body.id)}`, { isActive: false });
    expect((await cam()).status).toBe(401);
    await asAdmin.patch(`/api/gates/${String(gate.body.id)}`, { isActive: true });
    expect((await cam()).status).toBe(200);
    await asAdmin.patch(`/api/devices/${String(device.body.id)}`, { isActive: false });
    expect((await cam()).status).toBe(401);
  });
});

describe("watchlist", () => {
  it("stores cleaned plates and refuses duplicates", async () => {
    const { asAdmin } = await adminApi();
    const created = await asAdmin.post("/api/watchlist", {
      plate: "hr26 dk 0091",
      reason: "Reported stolen",
    });
    expect(created.status).toBe(201);
    expect(created.body.plate).toBe("HR26DK0091");
    expect(
      (await asAdmin.post("/api/watchlist", { plate: "HR26DK0091", reason: "Again" })).status,
    ).toBe(409);
  });
});

describe("audit log", () => {
  it("records who changed what, with before/after values and no secrets", async () => {
    const { asAdmin, admin } = await adminApi();
    const flat = await asAdmin.post("/api/flats", { block: "A", number: "101", floor: 1 });
    const vehicle = await asAdmin.post("/api/vehicles", {
      flatId: flat.body.id,
      plate: "UP16AB1234",
      vehicleType: "car",
      colour: "White",
    });
    await asAdmin.patch(`/api/vehicles/${String(vehicle.body.id)}`, { colour: "Grey" });
    await asAdmin.post("/api/guards", {
      email: "g@example.com",
      fullName: "Guard",
      password: "long-enough-pw",
    });

    const update = await asAdmin.get(`/api/audit-logs?action=vehicle.update`);
    expect(update.body.items).toHaveLength(1);
    expect(update.body.items[0]).toMatchObject({
      action: "vehicle.update",
      entityType: "vehicle",
      entityId: vehicle.body.id,
      changes: { colour: ["White", "Grey"] },
      actor: { id: admin.id },
    });

    const all = await asAdmin.get("/api/audit-logs?limit=100");
    expect(all.body.items.map((i: { action: string }) => i.action)).toEqual([
      "guard.create",
      "vehicle.update",
      "vehicle.create",
      "flat.create",
    ]);
    expect(JSON.stringify(all.body)).not.toMatch(/argon2|passwordHash|long-enough-pw/);
  });
});
