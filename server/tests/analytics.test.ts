// Phase 6: analytics (IST hours and days, averages, overstay rate, frequent visitors, inside now)
// and demo mode (404 unless DEMO_MODE=true).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { prisma } from "../src/db.js";
import { demoResetRunning, runDemoReset } from "../src/routes/demo.js";
import { newDeviceKey } from "../src/routes/devices.js";
import { inside, istDate, overview } from "../src/services/analytics.js";
import { ingestRead } from "../src/services/gateEvents.js";
import { createVisit, transitionVisit } from "../src/services/visits.js";
import { createUser, makeApi, resetDb, tokenFor } from "./helpers.js";

const MIN = 60_000;
// 10:00 IST on 20 Nov 2026 (04:30 UTC).
const T = new Date("2026-11-20T04:30:00.000Z");
const at = (minutes: number) => new Date(T.getTime() + minutes * MIN);

let flatId = "";
let entry = { deviceId: "", gateId: "" };
let exit = { deviceId: "", gateId: "" };

beforeEach(async () => {
  await resetDb();
  flatId = (await prisma.flat.create({ data: { block: "B", number: "402", floor: 4 } })).id;
  const gate = await prisma.gate.create({ data: { name: "Main gate" } });
  const device = async (direction: "entry" | "exit") => {
    const k = newDeviceKey();
    const d = await prisma.device.create({
      data: {
        gateId: gate.id,
        name: direction,
        direction,
        apiKeyHash: k.hash,
        apiKeyPrefix: k.prefix,
      },
    });
    return { deviceId: d.id, gateId: gate.id };
  };
  entry = await device("entry");
  exit = await device("exit");
  await prisma.vehicle.create({
    data: { flatId, plateRaw: "UP16AB1234", plateNormalized: "UP16AB1234", vehicleType: "car" },
  });
});

const read = (lane: typeof entry, direction: "entry" | "exit", plate: string, when: Date) =>
  ingestRead({
    ...lane,
    direction,
    plateText: plate,
    confidence: 0.95,
    capturedAt: when,
  });

/** A visit that entered at `enter` minutes and left at `leave` minutes (null = still inside). */
async function visit(plate: string, enter: number, leave: number | null, overstay = false) {
  return prisma.$transaction(async (tx) => {
    let v = await createVisit(tx, {
      flatId,
      category: "delivery",
      status: "approved",
      plateNormalized: plate,
      at: at(enter - 1),
    });
    v = await transitionVisit(tx, v.id, "enter", { at: at(enter) });
    if (overstay) v = await transitionVisit(tx, v.id, "overstay", { at: at(enter + 20) });
    if (leave !== null) v = await transitionVisit(tx, v.id, "exit", { at: at(leave) });
    return v;
  });
}

describe("istDate", () => {
  it("uses the Indian calendar day, not UTC", () => {
    expect(istDate(new Date("2026-11-20T19:00:00.000Z"))).toBe("2026-11-21"); // 00:30 IST
    expect(istDate(new Date("2026-11-20T18:00:00.000Z"))).toBe("2026-11-20"); // 23:30 IST
  });
});

describe("overview", () => {
  it("is all zeros (but complete) on an empty society", async () => {
    const o = await overview(7, T);
    expect(o.totals).toEqual({ gateEvents: 0, residentEntries: 0, visits: 0, completedVisits: 0 });
    expect(o.averageVisitMinutes).toBeNull();
    expect(o.overstayRate).toBeNull();
    expect(o.busiestHours).toHaveLength(24);
    expect(o.daily).toHaveLength(7);
    expect(o.daily.at(-1)?.date).toBe("2026-11-20");
  });

  it("counts entries per IST hour and per IST day", async () => {
    await read(entry, "entry", "UP16AB1234", at(0)); // 10:00 IST
    await read(exit, "exit", "UP16AB1234", at(30));
    await read(entry, "entry", "UP16AB1234", at(45)); // 10:45 IST
    await read(entry, "entry", "DL3CAB1234", at(90)); // 11:30 IST, unknown car
    const o = await overview(14, at(120));
    expect(o.totals.gateEvents).toBe(4);
    expect(o.totals.residentEntries).toBe(2);
    expect(o.busiestHours[10]).toEqual({ hour: 10, entries: 2 });
    expect(o.busiestHours[11]).toEqual({ hour: 11, entries: 1 });
    expect(o.daily.at(-1)).toEqual({ date: "2026-11-20", residentEntries: 2, visits: 0 });
  });

  it("averages completed visits, rates overstays, lists repeat visitors", async () => {
    await visit("MH12DE1433", 0, 10);
    await visit("MH12DE1433", 100, 130, true);
    await visit("KA05MN0042", 200, null);
    const o = await overview(14, at(300));
    expect(o.totals.visits).toBe(3);
    expect(o.totals.completedVisits).toBe(2);
    expect(o.averageVisitMinutes).toBe(20);
    expect(o.overstayRate).toBeCloseTo(1 / 3, 3);
    expect(o.byCategory).toEqual([{ category: "delivery", visits: 3 }]);
    expect(o.frequentVisitors).toEqual([
      {
        plate: "MH12DE1433",
        visits: 2,
        lastVisitAt: at(99).toISOString(),
        flatLabel: "B-402",
      },
    ]);
  });

  it("ignores what happened before the window", async () => {
    await visit("MH12DE1433", 0, 10);
    const o = await overview(1, at(2 * 24 * 60));
    expect(o.totals.visits).toBe(0);
    expect(o.averageVisitMinutes).toBeNull();
  });
});

describe("inside", () => {
  it("lists visitors inside and counts resident cars whose last read was an entry", async () => {
    await read(entry, "entry", "UP16AB1234", at(0));
    await visit("KA05MN0042", 5, null);
    await visit("MH12DE1433", 0, 10);
    let now = await inside();
    expect(now.residentVehicles).toBe(1);
    expect(now.visitors.map((v) => v.plate)).toEqual(["KA05MN0042"]);
    expect(now.total).toBe(2);

    await read(exit, "exit", "UP16AB1234", at(60));
    now = await inside();
    expect(now.residentVehicles).toBe(0);
    expect(now.total).toBe(1);
  });
});

describe("routes", () => {
  it("admin gets the overview; guard gets only who is inside", async () => {
    const api = makeApi();
    const admin = api.as(await tokenFor((await createUser("admin")).id));
    const guard = api.as(await tokenFor((await createUser("guard")).id));
    const o = await admin.get("/api/analytics/overview?days=7");
    expect(o.status).toBe(200);
    expect(o.body.daily).toHaveLength(7);
    expect((await admin.get("/api/analytics/overview?days=0")).status).toBe(422);
    expect((await guard.get("/api/analytics/overview")).status).toBe(403);
    const i = await guard.get("/api/analytics/inside");
    expect(i.status).toBe(200);
    expect(i.body).toEqual({ visitors: [], residentVehicles: 0, total: 0 });
  });
});

describe("demo mode", () => {
  const saved = { mode: config.DEMO_MODE, password: config.DEMO_PASSWORD };
  afterEach(() => {
    config.DEMO_MODE = saved.mode;
    config.DEMO_PASSWORD = saved.password;
  });

  it("is 404 when DEMO_MODE is off", async () => {
    config.DEMO_MODE = false;
    config.DEMO_PASSWORD = "demo-pass";
    expect((await makeApi().as().get("/api/demo")).status).toBe(404);
  });

  it("lists the three demo logins when DEMO_MODE is on", async () => {
    config.DEMO_MODE = true;
    config.DEMO_PASSWORD = "demo-pass";
    const res = await makeApi().as().get("/api/demo");
    expect(res.status).toBe(200);
    expect(res.body.password).toBe("demo-pass");
    expect(res.body.accounts.map((a: { role: string }) => a.role)).toEqual([
      "guard",
      "resident",
      "admin",
    ]);
  });
});

describe("demo reset", () => {
  const saved = { mode: config.DEMO_MODE, password: config.DEMO_PASSWORD };
  afterEach(() => {
    config.DEMO_MODE = saved.mode;
    config.DEMO_PASSWORD = saved.password;
  });

  it("is 404 when demo mode is off, and admin-only when on", async () => {
    const api = makeApi();
    const admin = api.as(await tokenFor((await createUser("admin")).id));
    const guard = api.as(await tokenFor((await createUser("guard")).id));
    config.DEMO_MODE = false;
    expect((await admin.post("/api/demo/reset", { history: false })).status).toBe(404);
    config.DEMO_MODE = true;
    config.DEMO_PASSWORD = "demo-pass";
    expect((await guard.post("/api/demo/reset", { history: false })).status).toBe(403);
  });

  it("starts in the background (202), refuses a second run (409), then the demo logins work", async () => {
    config.DEMO_MODE = true;
    config.DEMO_PASSWORD = "demo-pass";
    const api = makeApi();
    const admin = api.as(await tokenFor((await createUser("admin")).id));
    const res = await admin.post("/api/demo/reset", { history: false });
    expect(res.status).toBe(202);
    expect(demoResetRunning()).toBe(true);
    expect((await admin.post("/api/demo/reset", { history: false })).status).toBe(409);
    expect((await api.as().get("/api/demo")).body.resetting).toBe(true);

    await vi.waitFor(
      () => {
        expect(demoResetRunning()).toBe(false);
      },
      { timeout: 30_000, interval: 200 },
    );
    expect(await prisma.flat.count()).toBe(40);
    expect(await prisma.device.count()).toBe(4);
    const login = await api
      .as()
      .post("/api/auth/login", { email: "guard@example.com", password: "demo-pass" });
    expect(login.status).toBe(200);
  }, 40_000);

  it("gives the same people and plates every time", async () => {
    config.DEMO_PASSWORD = "demo-pass";
    expect(await runDemoReset({ history: false })).toBe(true);
    const first = (await prisma.vehicle.findMany({ orderBy: { plateNormalized: "asc" } })).map(
      (v) => v.plateNormalized,
    );
    expect(await runDemoReset({ history: false })).toBe(true);
    const second = (await prisma.vehicle.findMany({ orderBy: { plateNormalized: "asc" } })).map(
      (v) => v.plateNormalized,
    );
    expect(second).toEqual(first);
  }, 40_000);
});
