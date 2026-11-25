// Gate event engine, driven through the HTTP API exactly like a camera would (brief §19 Phase 2:
// "a scripted sequence of events produces correct visits, alerts and review items").
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { newDeviceKey } from "../src/routes/devices.js";
import { applyDecision } from "../src/services/gateEvents.js";
import { createVisit } from "../src/services/visits.js";
import { createUser, makeApi, resetDb, tokenFor } from "./helpers.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const T0 = new Date(Date.now() - 6 * 3600_000); // well in the past, so no "future" checks trip
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000).toISOString();

let api: ReturnType<typeof makeApi>;
let entryKey = "";
let exitKey = "";
let flatId = "";
let guardToken = "";

beforeEach(async () => {
  await resetDb();
  await rm(process.env.SNAPSHOT_LOCAL_DIR ?? "", { recursive: true, force: true });
  api = makeApi();
  const gate = await prisma.gate.create({ data: { name: "Main gate" } });
  for (const direction of ["entry", "exit"] as const) {
    const k = newDeviceKey();
    await prisma.device.create({
      data: {
        gateId: gate.id,
        name: `${direction} cam`,
        direction,
        apiKeyHash: k.hash,
        apiKeyPrefix: k.prefix,
      },
    });
    if (direction === "entry") entryKey = k.key;
    else exitKey = k.key;
  }
  flatId = (await prisma.flat.create({ data: { block: "B", number: "402", floor: 4 } })).id;
  guardToken = await tokenFor((await createUser("guard")).id);
});

interface Read {
  plate: string;
  confidence?: number;
  t?: number;
  key?: string;
  snapshot?: Buffer;
  direction?: string;
}

function post(read: Read) {
  let req = request(api.app)
    .post("/api/gate-events")
    .set("X-Device-Key", read.key ?? entryKey)
    .field("plate_text", read.plate)
    .field("confidence", String(read.confidence ?? 0.95))
    .field("captured_at", at(read.t ?? 0));
  if (read.direction) req = req.field("direction", read.direction);
  if (read.snapshot) req = req.attach("snapshot", read.snapshot, "snap.jpg");
  return req;
}

const vehicle = (plate: string) =>
  prisma.vehicle.create({
    data: { flatId, plateRaw: plate, plateNormalized: plate, vehicleType: "car" },
  });

describe("resident vehicles", () => {
  it("logs the entry (repairing the read) and pairs the exit with it", async () => {
    const car = await vehicle("UP16AB1234");

    const entry = await post({ plate: "UP16 AB I234 IND", t: 0 });
    expect(entry.status).toBe(201);
    expect(entry.body.status).toBe("created");
    expect(entry.body.event).toMatchObject({
      plate: "UP16AB1234",
      plateRaw: "UP16 AB I234 IND",
      ocrFixes: 1,
      direction: "entry",
      matchResult: "resident",
      matchDistance: 0,
      vehicle: { id: car.id, flatLabel: "B-402" },
      needsReview: false,
    });

    const exit = await post({ plate: "UP16AB1234", t: 7200, key: exitKey });
    expect(exit.body.event).toMatchObject({
      matchResult: "resident",
      direction: "exit",
      pairedEventId: entry.body.event.id,
    });
  });

  it("matches a read one character off, and leaves an exit with no entry unpaired", async () => {
    await vehicle("UP16AB1234");
    const res = await post({ plate: "UP16AB1284", key: exitKey });
    expect(res.body.event).toMatchObject({
      matchResult: "resident",
      matchDistance: 1,
      pairedEventId: null,
    });
  });

  it("does not guess between two equally close plates", async () => {
    await vehicle("UP16AB1235");
    await vehicle("UP16AB1236");
    const res = await post({ plate: "UP16AB1234" });
    expect(res.body.event).toMatchObject({
      matchResult: "ambiguous",
      needsReview: true,
      vehicle: null,
    });
    expect(res.body.event.reviewReason).toMatch(/UP16AB1235, UP16AB1236/);
  });
});

describe("idempotency and debounce", () => {
  it("an exact retry returns the first result (duplicate)", async () => {
    const first = await post({ plate: "KA05MN0042", t: 0 });
    const again = await post({ plate: "KA05MN0042", t: 0 });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: "duplicate", event: { id: first.body.event.id } });
    expect(await prisma.gateEvent.count()).toBe(1);
  });

  it("the same car in front of the camera is one event (sliding 30 s window)", async () => {
    const first = await post({ plate: "KA05MN0042", t: 0 });
    const r10 = await post({ plate: "KA05MN0042", t: 10 });
    const r35 = await post({ plate: "KAO5MN0042", t: 35 }); // repaired to the same plate
    expect(r10.body).toMatchObject({ status: "debounced", event: { id: first.body.event.id } });
    expect(r35.body).toMatchObject({
      status: "debounced",
      event: { id: first.body.event.id, lastSeenAt: at(35) },
    });

    const later = await post({ plate: "KA05MN0042", t: 70 });
    expect(later.status).toBe(201);
    expect(await prisma.gateEvent.count()).toBe(2);
  });

  it("an old read replayed from the camera's offline buffer stays a separate event", async () => {
    await post({ plate: "KA05MN0042", t: 3600 });
    const replayed = await post({ plate: "KA05MN0042", t: 0 });
    expect(replayed.status).toBe(201);
    expect(await prisma.gateEvent.count()).toBe(2);
  });

  it("two identical uploads at the same moment store one event", async () => {
    const [a, b] = await Promise.all([
      post({ plate: "GJ01RX5678" }),
      post({ plate: "GJ01RX5678" }),
    ]);
    expect([a.body.status, b.body.status].sort()).toEqual(["created", "duplicate"]);
    expect(a.body.event.id).toBe(b.body.event.id);
    expect(await prisma.gateEvent.count()).toBe(1);
  });
});

describe("watchlist, low confidence and the review queue", () => {
  it("raises a critical alert for a watchlist plate even on a low-confidence read", async () => {
    await prisma.watchlistEntry.create({
      data: { plateRaw: "HR26DK0091", plateNormalized: "HR26DK0091", reason: "Reported stolen" },
    });
    const res = await post({ plate: "HR26DKOO91", confidence: 0.5 });
    expect(res.body.event).toMatchObject({ matchResult: "watchlist", needsReview: true });
    expect(res.body.event.alertIds).toHaveLength(1);

    const guard = api.as(guardToken);
    const alerts = await guard.get("/api/alerts?acknowledged=false");
    expect(alerts.body.items[0]).toMatchObject({ severity: "critical", plate: "HR26DK0091" });
    expect(alerts.body.items[0].message).toMatch(/Main gate \(entry\): Reported stolen/);

    const id = alerts.body.items[0].id as string;
    const ack1 = await guard.post(`/api/alerts/${id}/acknowledge`);
    const ack2 = await guard.post(`/api/alerts/${id}/acknowledge`);
    expect(ack1.body.acknowledgedAt).not.toBeNull();
    expect(ack2.body.acknowledgedAt).toBe(ack1.body.acknowledgedAt);
  });

  it("sends low-confidence and unreadable reads to the guard, who can correct them once", async () => {
    const car = await vehicle("UP16AB1234");
    const blurry = await post({ plate: "UP16AB1234", confidence: 0.4 });
    const garbage = await post({ plate: "XX99ZZ", t: 5 });
    expect(blurry.body.event).toMatchObject({ matchResult: "low_confidence", needsReview: true });
    expect(blurry.body.event.reviewReason).toMatch(/Low OCR confidence \(0\.40 < 0\.80\)/);
    expect(garbage.body.event).toMatchObject({ matchResult: "low_confidence", needsReview: true });
    expect(garbage.body.event.reviewReason).toMatch(/could not be read/);

    const guard = api.as(guardToken);
    const queue = await guard.get("/api/gate-events/review-queue");
    expect(queue.body.items.map((e: { id: string }) => e.id)).toEqual([
      blurry.body.event.id,
      garbage.body.event.id,
    ]);

    const fixed = await guard.post(`/api/gate-events/${String(blurry.body.event.id)}/review`, {
      action: "correct",
      plate: "up16 ab 1234",
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({
      plate: "UP16AB1234",
      matchResult: "resident",
      vehicle: { id: car.id },
      needsReview: false,
    });
    expect(await prisma.plateCorrection.findFirst()).toMatchObject({
      originalPlate: "UP16AB1234",
      correctedPlate: "UP16AB1234",
    });

    expect(
      (
        await guard.post(`/api/gate-events/${String(blurry.body.event.id)}/review`, {
          action: "dismiss",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await guard.post(`/api/gate-events/${String(garbage.body.event.id)}/review`, {
          action: "correct",
          plate: "nonsense",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await guard.post(`/api/gate-events/${String(garbage.body.event.id)}/review`, {
          action: "dismiss",
        })
      ).status,
    ).toBe(200);
    expect((await guard.get("/api/gate-events/review-queue")).body.total).toBe(0);
  });

  it("refuses to review a read that never needed it", async () => {
    await vehicle("UP16AB1234");
    const ok = await post({ plate: "UP16AB1234" });
    const res = await api
      .as(guardToken)
      .post(`/api/gate-events/${String(ok.body.event.id)}/review`, { action: "dismiss" });
    expect(res.status).toBe(409);
  });

  it("an unknown car is neither matched nor sent for review", async () => {
    const res = await post({ plate: "MH12DE1433" });
    expect(res.body.event).toMatchObject({ matchResult: "unknown", needsReview: false });
  });
});

describe("expected visitors", () => {
  it("moves an approved visit inside at entry (timer starts) and closes it at exit", async () => {
    const visit = await prisma.$transaction((tx) =>
      createVisit(tx, {
        flatId,
        category: "delivery",
        status: "approved",
        plateNormalized: "DL3CAF7203",
        at: new Date(T0.getTime() - 60_000), // approved a minute before the car arrives
      }),
    );
    const task = await prisma.escalationTask.create({ data: { visitId: visit.id } });

    const entry = await post({ plate: "DL3CAF72O3", t: 0 });
    expect(entry.body.event).toMatchObject({ matchResult: "visitor", visitId: visit.id });
    const inside = await prisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
    expect(inside.status).toBe("inside");
    expect(inside.enteredAt?.toISOString()).toBe(at(0));
    expect(inside.expectedExitAt?.toISOString()).toBe(at(20 * 60)); // delivery: 20 minutes
    expect(inside.entryEventId).toBe(entry.body.event.id);

    const exit = await post({ plate: "DL3CAF7203", t: 25 * 60, key: exitKey });
    expect(exit.body.event).toMatchObject({ matchResult: "visitor", visitId: visit.id });
    const done = await prisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
    expect(done).toMatchObject({
      status: "exited",
      durationMinutes: 25,
      exitEventId: exit.body.event.id,
    });
    expect(await prisma.escalationTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject(
      {
        status: "resolved",
        outcome: "vehicle_left",
      },
    );

    const history = await prisma.visitStatusChange.findMany({
      where: { visitId: visit.id },
      orderBy: { changedAt: "asc" },
    });
    expect(history.map((h) => `${h.trigger}:${h.toStatus}`)).toEqual([
      "create:approved",
      "enter:inside",
      "exit:exited",
    ]);
  });

  it("a visitor seen on the wrong lane is not matched to the visit", async () => {
    await prisma.$transaction((tx) =>
      createVisit(tx, {
        flatId,
        category: "guest",
        status: "approved",
        plateNormalized: "DL3CAF7203",
      }),
    );
    const res = await post({ plate: "DL3CAF7203", key: exitKey });
    expect(res.body.event).toMatchObject({ matchResult: "unknown", visitId: null });
  });
});

describe("snapshots and input checks", () => {
  it("stores a JPEG snapshot that staff can download", async () => {
    const res = await post({ plate: "UP16AB1234", snapshot: JPEG });
    expect(res.body.event.hasSnapshot).toBe(true);
    const img = await api
      .as(guardToken)
      .get(`/api/gate-events/${String(res.body.event.id)}/snapshot`);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");
    expect(Buffer.compare(img.body as Buffer, JPEG)).toBe(0);
  });

  it("deletes the snapshot of a retry, keeping only the first", async () => {
    await post({ plate: "UP16AB1234", snapshot: JPEG });
    await post({ plate: "UP16AB1234", snapshot: JPEG });
    const dir = process.env.SNAPSHOT_LOCAL_DIR ?? "";
    const files = await readdir(dir, { recursive: true, withFileTypes: true });
    expect(files.filter((f) => f.isFile()).map((f) => path.extname(f.name))).toEqual([".jpg"]);
  });

  it("rejects non-images (422), oversized snapshots (413) and bad fields", async () => {
    expect(
      (await post({ plate: "UP16AB1234", snapshot: Buffer.from("not an image at all") })).status,
    ).toBe(422);
    expect(
      (
        await post({
          plate: "UP16AB1234",
          snapshot: Buffer.concat([JPEG, Buffer.alloc(2_000_001)]),
        })
      ).status,
    ).toBe(413);
    expect((await post({ plate: "UP16AB1234", confidence: 1.5 })).status).toBe(422);
    expect((await post({ plate: "UP16AB1234", direction: "exit" })).status).toBe(422);

    const future = await request(api.app)
      .post("/api/gate-events")
      .set("X-Device-Key", entryKey)
      .field("plate_text", "UP16AB1234")
      .field("confidence", "0.9")
      .field("captured_at", new Date(Date.now() + 10 * 60_000).toISOString());
    expect(future.status).toBe(422);
    expect(future.body.detail).toMatch(/future/);
    expect(await prisma.gateEvent.count()).toBe(0);
  });
});

describe("listing", () => {
  it("filters events and exports CSV with formula-safe cells", async () => {
    await vehicle("UP16AB1234");
    await post({ plate: "UP16AB1234", t: 0 });
    await post({ plate: "MH12DE1433", t: 100, confidence: 0.3 });
    await post({ plate: "=HYPERLINK(1)", t: 200 });

    const guard = api.as(guardToken);
    expect((await guard.get("/api/gate-events")).body.total).toBe(3);
    expect((await guard.get("/api/gate-events?matchResult=resident")).body.total).toBe(1);
    expect((await guard.get("/api/gate-events?needsReview=true")).body.total).toBe(2);
    expect((await guard.get("/api/gate-events?q=mh12")).body.total).toBe(1);

    const csv = await guard.get("/api/gate-events?format=csv");
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    const lines = csv.text.trim().split("\n");
    expect(lines[0]).toBe(
      "captured_at,gate,direction,plate,plate_raw,confidence,match_result,flat,needs_review,review_reason",
    );
    expect(lines).toHaveLength(4);
    expect(csv.text).toContain("'=HYPERLINK(1)");
    expect(csv.text).toContain("B-402");
  });
});

describe("races", () => {
  it("never drops a car when its visit changed state between matching and the move", async () => {
    const visit = await prisma.$transaction((tx) =>
      createVisit(tx, {
        flatId,
        category: "guest",
        status: "approved",
        plateNormalized: "DL3CAF7203",
      }),
    );
    // A read arrives while the visit is still "approved" (it matches as a visitor)…
    const read = await post({ plate: "MH12DE1433" });
    // …but before the camera's move is applied, a guard expires the visit.
    await prisma.visit.update({ where: { id: visit.id }, data: { status: "expired" } });

    const event = await prisma.gateEvent.findUniqueOrThrow({ where: { id: read.body.event.id } });
    const after = await prisma.$transaction((tx) =>
      applyDecision(tx, event, {
        matchResult: "visitor",
        matchDistance: 0,
        vehicleId: null,
        visitId: visit.id,
        needsReview: false,
        reviewReason: null,
        watchlist: null,
      }),
    );
    expect(after).toMatchObject({
      needsReview: true,
      reviewReason: 'Visit could not enter: it is now "expired"',
    });
    expect(await prisma.visit.findUniqueOrThrow({ where: { id: visit.id } })).toMatchObject({
      status: "expired",
    });
  });
});
