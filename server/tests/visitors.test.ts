// Phase 4 (brief §19): the full unknown-visitor path end to end, approvals with timeout and guard
// fallback, guest passes, settings, and real-time events seen by real Socket.io clients.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { createApp } from "../src/index.js";
import { runApprovalExpiry } from "../src/jobs.js";
import { closeRealtime, initRealtime } from "../src/realtime.js";
import { maskPhone } from "../src/routes/visits.js";
import { newDeviceKey } from "../src/routes/devices.js";
import { CODE_ALPHABET, newCode } from "../src/services/guestPasses.js";
import { createUser, resetDb, tokenFor } from "./helpers.js";

const app = createApp();
let server: Server;
let baseUrl = "";

beforeAll(async () => {
  server = createServer(app);
  initRealtime(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await closeRealtime();
  await new Promise((resolve) => server.close(resolve));
});

let flatId = "";
let otherFlatId = "";
let entryKey = "";
let exitKey = "";
let guard = { id: "", token: "" };
let resident = { id: "", token: "" };
let neighbour = { id: "", token: "" };
let admin = { id: "", token: "" };

beforeEach(async () => {
  await resetDb();
  flatId = (await prisma.flat.create({ data: { block: "B", number: "402", floor: 4 } })).id;
  otherFlatId = (await prisma.flat.create({ data: { block: "C", number: "101", floor: 1 } })).id;
  const g = await createUser("guard");
  const r = await createUser("resident", { flatId });
  const n = await createUser("resident", { flatId: otherFlatId });
  const a = await createUser("admin");
  guard = { id: g.id, token: await tokenFor(g.id) };
  resident = { id: r.id, token: await tokenFor(r.id) };
  neighbour = { id: n.id, token: await tokenFor(n.id) };
  admin = { id: a.id, token: await tokenFor(a.id) };
  const gate = await prisma.gate.create({ data: { name: "Main gate" } });
  for (const direction of ["entry", "exit"] as const) {
    const k = newDeviceKey();
    await prisma.device.create({
      data: {
        gateId: gate.id,
        name: direction,
        direction,
        apiKeyHash: k.hash,
        apiKeyPrefix: k.prefix,
      },
    });
    if (direction === "entry") entryKey = k.key;
    else exitKey = k.key;
  }
});

const as = (token: string) => ({
  get: (url: string) => request(app).get(url).set("Authorization", `Bearer ${token}`),
  post: (url: string, body?: object) =>
    request(app)
      .post(url)
      .set("Authorization", `Bearer ${token}`)
      .send(body ?? {}),
  patch: (url: string, body: object) =>
    request(app).patch(url).set("Authorization", `Bearer ${token}`).send(body),
});

function camera(key: string, plate: string, at = new Date()) {
  return request(app)
    .post("/api/gate-events")
    .set("X-Device-Key", key)
    .field("plate_text", plate)
    .field("confidence", "0.95")
    .field("captured_at", at.toISOString());
}

/** A Socket.io client that records every event it receives. */
async function listen(
  token: string,
): Promise<{ socket: Socket; events: { type: string; data: unknown }[] }> {
  const events: { type: string; data: unknown }[] = [];
  const socket = connect(baseUrl, {
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
  });
  socket.onAny((type: string, payload: { data: unknown }) =>
    events.push({ type, data: payload.data }),
  );
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => {
      resolve();
    });
    socket.on("connect_error", reject);
  });
  return { socket, events };
}

const until = async (check: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for real-time event");
    await new Promise((r) => setTimeout(r, 20));
  }
};

const register = (gateEventId?: string, extra: object = {}) =>
  as(guard.token).post("/api/visits", {
    flatId,
    category: "delivery",
    visitor: { fullName: "Ravi Kumar", phone: "+919876543210", email: "ravi@example.com" },
    purpose: "Amazon parcel",
    ...(gateEventId ? { gateEventId } : {}),
    ...extra,
  });

describe("the unknown-visitor path, end to end", () => {
  it("camera → guard registers → resident approves → car let in → exit closes the visit", async () => {
    const guardLive = await listen(guard.token);
    const residentLive = await listen(resident.token);
    const neighbourLive = await listen(neighbour.token);

    // 1. An unknown car at the entry camera.
    const read = await camera(entryKey, "MH12DE1433");
    expect(read.body.event.matchResult).toBe("unknown");
    await until(() => guardLive.events.some((e) => e.type === "gate_event.created"));
    expect(residentLive.events.some((e) => e.type === "gate_event.created")).toBe(false); // staff only

    // 2. The guard registers the visitor against that read.
    const reg = await register(read.body.event.id);
    expect(reg.status).toBe(201);
    expect(reg.body).toMatchObject({
      status: "pending_approval",
      plate: "MH12DE1433",
      flatLabel: "B-402",
      approval: { status: "pending" },
    });
    expect(reg.body.approval.secondsLeft).toBeGreaterThan(170);
    await until(() => residentLive.events.some((e) => e.type === "approval.requested"));
    expect(guardLive.events.some((e) => e.type === "approval.requested")).toBe(true);
    expect(neighbourLive.events.some((e) => e.type === "approval.requested")).toBe(false);

    // Registering the same car twice is refused (brief §17).
    expect((await register(read.body.event.id)).status).toBe(409);

    // 3. The resident approves: the waiting car is let in at once.
    const approvalId = reg.body.approval.id as string;
    const ok = await as(resident.token).post(`/api/approvals/${approvalId}/decision`, {
      decision: "approve",
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      status: "inside",
      approval: { status: "approved", channel: "web" },
    });
    expect(ok.body.expectedExitAt).not.toBeNull();
    await until(() => guardLive.events.some((e) => e.type === "visit.updated"));
    expect(residentLive.events.some((e) => e.type === "approval.decided")).toBe(true);

    // Same answer again is fine; a different one is refused.
    expect(
      (
        await as(resident.token).post(`/api/approvals/${approvalId}/decision`, {
          decision: "approve",
        })
      ).status,
    ).toBe(200);
    expect(
      (await as(resident.token).post(`/api/approvals/${approvalId}/decision`, { decision: "deny" }))
        .status,
    ).toBe(409);

    // 4. The exit camera reads the plate: the visit is closed.
    const out = await camera(exitKey, "MH12DE1433", new Date(Date.now() + 60_000));
    expect(out.body.event).toMatchObject({ matchResult: "visitor", visitId: reg.body.id });
    const done = await as(guard.token).get(`/api/visits/${String(reg.body.id)}`);
    expect(done.body.status).toBe("exited");

    const history = await prisma.visitStatusChange.findMany({
      where: { visitId: reg.body.id },
      orderBy: { changedAt: "asc" },
    });
    expect(history.map((h) => h.toStatus)).toEqual([
      "pending_approval",
      "approved",
      "inside",
      "exited",
    ]);

    for (const l of [guardLive, residentLive, neighbourLive]) l.socket.disconnect();
  });

  it("without a waiting car, approval leaves the visit approved until a camera read lets it in", async () => {
    const reg = await register(undefined, { plate: "KA05MN0042" });
    const ok = await as(resident.token).post(
      `/api/approvals/${String(reg.body.approval.id)}/decision`,
      { decision: "approve" },
    );
    expect(ok.body.status).toBe("approved");
    const read = await camera(entryKey, "KA05MN0042");
    expect(read.body.event).toMatchObject({ matchResult: "visitor", visitId: reg.body.id });
    expect((await as(guard.token).get(`/api/visits/${String(reg.body.id)}`)).body.status).toBe(
      "inside",
    );
  });

  it("a resident can deny; residents of other flats cannot answer", async () => {
    const reg = await register();
    const url = `/api/approvals/${String(reg.body.approval.id)}/decision`;
    expect((await as(neighbour.token).post(url, { decision: "approve" })).status).toBe(404);
    expect((await as(guard.token).post(url, { decision: "approve" })).status).toBe(403);
    const denied = await as(resident.token).post(url, { decision: "deny" });
    expect(denied.body).toMatchObject({ status: "denied", approval: { status: "denied" } });
  });

  it("two residents tapping at once: the first answer wins, the other gets 409", async () => {
    const partner = await createUser("resident", { flatId });
    const partnerToken = await tokenFor(partner.id);
    const reg = await register();
    const url = `/api/approvals/${String(reg.body.approval.id)}/decision`;
    const [a, b] = await Promise.all([
      as(resident.token).post(url, { decision: "approve" }),
      as(partnerToken).post(url, { decision: "deny" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const visit = await prisma.visit.findUniqueOrThrow({ where: { id: reg.body.id } });
    expect(["approved", "denied"]).toContain(visit.status);
    expect(await prisma.visitStatusChange.count({ where: { visitId: reg.body.id } })).toBe(2); // create + one decision
  });
});

describe("timeout and the guard's fallback", () => {
  it("after 3 minutes residents are too late and the guard decides", async () => {
    const residentLive = await listen(resident.token);
    const reg = await register();
    const visitId = reg.body.id as string;

    // The guard can't jump in while residents can still answer.
    const early = await as(guard.token).post(`/api/visits/${visitId}/decision`, {
      decision: "approve",
    });
    expect(early.status).toBe(409);
    expect(early.body.detail).toMatch(/Residents can still answer/);

    // The 15-second job runs after the timeout.
    expect(await runApprovalExpiry(new Date(Date.now() + 181_000))).toBe(1);
    await until(() => residentLive.events.some((e) => e.type === "approval.timed_out"));

    const late = await as(resident.token).post(
      `/api/approvals/${String(reg.body.approval.id)}/decision`,
      { decision: "approve" },
    );
    expect(late.status).toBe(409);
    expect(late.body.detail).toMatch(/Too late/);

    const decided = await as(guard.token).post(`/api/visits/${visitId}/decision`, {
      decision: "approve",
    });
    expect(decided.body).toMatchObject({
      status: "approved",
      approval: { status: "timed_out", channel: "guard" },
    });
    expect(
      (await as(guard.token).post(`/api/visits/${visitId}/decision`, { decision: "approve" }))
        .status,
    ).toBe(200);
    expect(
      (await as(guard.token).post(`/api/visits/${visitId}/decision`, { decision: "deny" })).status,
    ).toBe(409);

    // No camera read: the guard lets the car in by hand.
    const entered = await as(guard.token).post(`/api/visits/${visitId}/enter`);
    expect(entered.body.status).toBe("inside");
    expect((await as(guard.token).post(`/api/visits/${visitId}/enter`)).status).toBe(409);
    residentLive.socket.disconnect();
  });

  it("a late answer marks the approval timed out even before the job runs", async () => {
    await as(admin.token).patch("/api/settings", { approvalTimeoutSeconds: 30 });
    const reg = await register();
    const approval = await prisma.approval.findUniqueOrThrow({
      where: { id: reg.body.approval.id },
    });
    expect(approval.expiresAt.getTime() - approval.createdAt.getTime()).toBeLessThanOrEqual(31_000);
    await prisma.approval.update({
      where: { id: approval.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const late = await as(resident.token).post(`/api/approvals/${approval.id}/decision`, {
      decision: "approve",
    });
    expect(late.status).toBe(409);
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe(
      "timed_out",
    );
  });
});

describe("guest passes", () => {
  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

  it("a pass by plate lets the car in on its own, once", async () => {
    const created = await as(resident.token).post("/api/guest-passes", {
      flatId,
      guestName: "Meera",
      plate: "dl3c af 7203",
      withCode: false,
      validUntil: tomorrow(),
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      plate: "DL3CAF7203",
      code: null,
      state: "active",
      maxUses: 1,
    });

    const read = await camera(entryKey, "DL3CAF7203");
    expect(read.body.event.matchResult).toBe("guest_pass");
    const visit = await as(guard.token).get(`/api/visits/${String(read.body.event.visitId)}`);
    expect(visit.body).toMatchObject({
      status: "inside",
      category: "guest",
      guestPassId: created.body.id,
    });

    // Used up: the same plate a minute later is an unknown car.
    const again = await camera(entryKey, "DL3CAF7203", new Date(Date.now() + 60_000));
    expect(again.body.event.matchResult).toBe("unknown");
  });

  it("a code is shown once, stored as a hash, and redeemed by the guard", async () => {
    const created = await as(resident.token).post("/api/guest-passes", {
      flatId,
      validUntil: tomorrow(),
      maxUses: 2,
    });
    const code = created.body.code as string;
    expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{8}$`));
    const stored = await prisma.guestPass.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.codeHash).not.toContain(code);
    expect((await as(resident.token).get("/api/guest-passes")).body.items[0]).not.toHaveProperty(
      "code",
    );

    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`;
    const inVisit = await as(guard.token).post("/api/guest-passes/redeem", { code: typed });
    expect(inVisit.status).toBe(201);
    expect(inVisit.body).toMatchObject({ status: "inside", flatLabel: "B-402" });
    expect((await as(guard.token).post("/api/guest-passes/redeem", { code })).status).toBe(201);
    const third = await as(guard.token).post("/api/guest-passes/redeem", { code });
    expect(third.status).toBe(409);
    expect(third.body.detail).toMatch(/used up/);
    expect(
      (await as(guard.token).post("/api/guest-passes/redeem", { code: "ZZZZZZZZ" })).status,
    ).toBe(404);
  });

  it("revoked and not-yet-valid passes do not open the gate", async () => {
    const pass = await as(resident.token).post("/api/guest-passes", {
      flatId,
      validUntil: tomorrow(),
    });
    await as(resident.token).post(`/api/guest-passes/${String(pass.body.id)}/revoke`);
    expect(
      (await as(guard.token).post("/api/guest-passes/redeem", { code: pass.body.code })).status,
    ).toBe(409);

    const later = await as(resident.token).post("/api/guest-passes", {
      flatId,
      validFrom: new Date(Date.now() + 3_600_000).toISOString(),
      validUntil: tomorrow(),
    });
    const res = await as(guard.token).post("/api/guest-passes/redeem", { code: later.body.code });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/not yet valid/);
  });

  it("residents only manage passes for their own flat; a pass needs a plate or a code", async () => {
    expect(
      (await as(neighbour.token).post("/api/guest-passes", { flatId, validUntil: tomorrow() }))
        .status,
    ).toBe(404);
    expect(
      (
        await as(resident.token).post("/api/guest-passes", {
          flatId,
          withCode: false,
          validUntil: tomorrow(),
        })
      ).status,
    ).toBe(422);
    const mine = await as(resident.token).post("/api/guest-passes", {
      flatId,
      validUntil: tomorrow(),
    });
    expect(
      (await as(neighbour.token).post(`/api/guest-passes/${String(mine.body.id)}/revoke`)).status,
    ).toBe(404);
    expect((await as(neighbour.token).get("/api/guest-passes")).body.total).toBe(0);
  });
});

describe("visit lists, settings, real-time auth", () => {
  it("masks phones in lists and scopes residents to their flats", async () => {
    await register();
    const staff = await as(guard.token).get("/api/visits");
    expect(staff.body.items[0].visitor.phone).toBe("+91 98•••••210");
    expect((await as(resident.token).get("/api/visits")).body.total).toBe(1);
    expect((await as(neighbour.token).get("/api/visits")).body.total).toBe(0);
    const detail = await as(guard.token).get(`/api/visits/${String(staff.body.items[0].id)}`);
    expect(detail.body.visitor.phone).toBe("+919876543210");
    expect(
      (await as(neighbour.token).get(`/api/visits/${String(staff.body.items[0].id)}`)).status,
    ).toBe(404);
  });

  it("maskPhone", () => {
    expect(maskPhone("+919876543210")).toBe("+91 98•••••210");
    expect(maskPhone("9876543210")).toBe("98•••••210");
    expect(maskPhone(null)).toBeNull();
  });

  it("settings: defaults, admin edits (audited), effect on visit time limits", async () => {
    expect((await as(guard.token).get("/api/settings")).body).toMatchObject({
      deliveryMinutes: 20,
      approvalTimeoutSeconds: 180,
    });
    expect((await as(guard.token).patch("/api/settings", { deliveryMinutes: 45 })).status).toBe(
      403,
    );
    const changed = await as(admin.token).patch("/api/settings", { deliveryMinutes: 45 });
    expect(changed.body.deliveryMinutes).toBe(45);
    expect(await prisma.auditLog.findFirst({ where: { action: "settings.update" } })).toMatchObject(
      {
        changes: { deliveryMinutes: [20, 45] },
      },
    );

    const read = await camera(entryKey, "MH12DE1433");
    const reg = await register(read.body.event.id);
    const ok = await as(resident.token).post(
      `/api/approvals/${String(reg.body.approval.id)}/decision`,
      { decision: "approve" },
    );
    const minutes = (Date.parse(ok.body.expectedExitAt) - Date.parse(ok.body.enteredAt)) / 60_000;
    expect(minutes).toBe(45);
  });

  it("refuses a socket without a valid token", async () => {
    const socket = connect(baseUrl, {
      auth: { token: "garbage" },
      transports: ["websocket"],
      reconnection: false,
    });
    const error = await new Promise<Error>((resolve) => socket.on("connect_error", resolve));
    expect(error.message).toBe("unauthorized");
    socket.disconnect();
  });

  it("a guest-pass code never uses look-alike characters", () => {
    for (let i = 0; i < 200; i++) expect(newCode()).not.toMatch(/[01OIL]/);
  });
});
