// Phase 5 (brief §19): the escalation ladder with a mocked clock (every step exactly once),
// the email outbox and dispatcher, reconciliation, retention and their APIs.
import { readdir, rm } from "node:fs/promises";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { createApp } from "../src/index.js";
import { runEscalationTick } from "../src/jobs.js";
import { dueSteps, runLadder } from "../src/services/escalation.js";
import {
  backoffMinutes,
  dispatchDue,
  type Mailer,
  MAX_ATTEMPTS,
  type OutgoingMail,
  queueEmail,
  templates,
} from "../src/services/notifications.js";
import { runReconciliation } from "../src/services/reconciliation.js";
import { runRetention } from "../src/services/retention.js";
import { saveSnapshot, snapshotKey } from "../src/services/storage.js";
import { createVisit, transitionVisit } from "../src/services/visits.js";
import { createUser, resetDb, tokenFor } from "./helpers.js";

const app = createApp();
const MIN = 60_000;
const T = new Date("2026-11-25T10:00:00.000Z"); // the visit's time limit in most tests
const at = (minutes: number) => new Date(T.getTime() + minutes * MIN);

let flatId = "";
let residentEmail = "";

beforeEach(async () => {
  await resetDb();
  flatId = (await prisma.flat.create({ data: { block: "B", number: "402", floor: 4 } })).id;
  const resident = await createUser("resident", { flatId, email: "priya@example.com" });
  residentEmail = resident.email;
});

/** A delivery visit that entered 20 minutes before T, so its time limit is exactly T. */
async function visitInsideUntilT(opts: { visitorEmail?: string } = {}) {
  return prisma.$transaction(async (tx) => {
    const visitor = await tx.visitor.create({
      data: {
        fullName: "Ravi Kumar",
        phone: "+919876543210",
        email: opts.visitorEmail ?? "ravi@example.com",
      },
    });
    const v = await createVisit(tx, {
      flatId,
      category: "delivery",
      status: "approved",
      visitorId: visitor.id,
      plateNormalized: "MH12DE1433",
      at: at(-25),
    });
    return transitionVisit(tx, v.id, "enter", { at: at(-20) });
  });
}

const statusOf = async (id: string) =>
  (await prisma.visit.findUniqueOrThrow({ where: { id } })).status;
const keys = async () =>
  (await prisma.notification.findMany({ orderBy: { idempotencyKey: "asc" } })).map(
    (n) => n.idempotencyKey,
  );

describe("dueSteps (pure)", () => {
  const v = (status: "inside" | "overstayed" | "escalated" | "exited") => ({
    status,
    expectedExitAt: T,
  });
  it.each([
    ["inside", -1, []],
    ["inside", 0, ["overstay"]],
    ["inside", 29, ["overstay"]],
    ["inside", 30, ["overstay", "reminder"]],
    ["inside", 60, ["overstay", "reminder", "escalate"]],
    ["overstayed", 10, []],
    ["overstayed", 45, ["reminder"]],
    ["overstayed", 61, ["reminder", "escalate"]],
    ["escalated", 90, ["reminder"]],
    ["exited", 90, []],
  ] as const)("%s at limit %+i min → %j", (status, minutes, steps) => {
    expect(dueSteps(v(status), at(minutes))).toEqual(steps);
  });

  it("does nothing without a time limit", () => {
    expect(dueSteps({ status: "inside", expectedExitAt: null }, at(999))).toEqual([]);
  });
});

describe("the escalation ladder with a mocked clock", () => {
  it("moves an overstaying visit through every step exactly once", async () => {
    const visit = await visitInsideUntilT();

    expect(await runLadder(at(-1))).toEqual([]);
    expect(await statusOf(visit.id)).toBe("inside");

    // At the limit: overstayed, visitor + resident emailed.
    await runLadder(at(1));
    expect(await statusOf(visit.id)).toBe("overstayed");
    expect(await keys()).toEqual([
      `visit:${visit.id}:overstay:resident:${(await prisma.user.findFirstOrThrow({ where: { role: "resident" } })).id}`,
      `visit:${visit.id}:overstay:visitor`,
    ]);

    // Running again changes nothing.
    expect(await runLadder(at(2))).toEqual([]);
    expect(await prisma.notification.count()).toBe(2);

    // +30 min: one reminder to the resident.
    await runLadder(at(31));
    await runLadder(at(35));
    expect((await keys()).filter((k) => k.includes("overstay_reminder"))).toHaveLength(1);

    // +60 min: escalated, one call-the-resident task.
    await runLadder(at(61));
    await runLadder(at(75));
    expect(await statusOf(visit.id)).toBe("escalated");
    expect(await prisma.escalationTask.count()).toBe(1);
    expect(await prisma.notification.count()).toBe(3);

    const history = await prisma.visitStatusChange.findMany({
      where: { visitId: visit.id },
      orderBy: { changedAt: "asc" },
    });
    expect(history.map((h) => `${h.trigger}@${h.changedAt.toISOString()}`)).toEqual([
      `create@${at(-25).toISOString()}`,
      `enter@${at(-20).toISOString()}`,
      `overstay@${T.toISOString()}`,
      `escalate@${at(60).toISOString()}`,
    ]);

    // The car leaves: the open task closes on its own.
    await prisma.$transaction((tx) => transitionVisit(tx, visit.id, "exit", { at: at(80) }));
    expect(await prisma.escalationTask.findFirstOrThrow()).toMatchObject({
      status: "resolved",
      outcome: "vehicle_left",
    });
  });

  it("after an outage, one run does every due step once, in order, timed when each was due", async () => {
    const visit = await visitInsideUntilT();
    const outcomes = await runLadder(at(95));
    expect(outcomes[0]?.steps).toEqual(["overstay", "reminder", "escalate"]);
    expect(await statusOf(visit.id)).toBe("escalated");
    expect(await prisma.notification.count()).toBe(3);
    const changes = await prisma.visitStatusChange.findMany({
      where: { visitId: visit.id, trigger: { in: ["overstay", "escalate"] } },
    });
    expect(changes.map((c) => c.changedAt.toISOString()).sort()).toEqual([
      T.toISOString(),
      at(60).toISOString(),
    ]);

    // Two runs racing after the outage still do everything only once.
    await Promise.all([runLadder(at(96)), runLadder(at(96))]);
    expect(await prisma.notification.count()).toBe(3);
    expect(await prisma.escalationTask.count()).toBe(1);
  });

  it("a visitor without an email is skipped; residents are still told", async () => {
    await prisma.$transaction(async (tx) => {
      const v = await createVisit(tx, { flatId, category: "cab", status: "approved", at: at(-15) });
      await transitionVisit(tx, v.id, "enter", { at: at(-10) });
    });
    await runLadder(at(1));
    expect((await prisma.notification.findMany()).map((n) => n.recipient)).toEqual([residentEmail]);
  });

  it("the job publishes and returns how many visits moved", async () => {
    await visitInsideUntilT();
    expect(await runEscalationTick(at(61))).toBe(1);
    expect(await runEscalationTick(at(62))).toBe(0);
  });
});

describe("email outbox and dispatcher", () => {
  class FakeMailer implements Mailer {
    sent: OutgoingMail[] = [];
    failuresLeft: number;
    constructor(failures = 0) {
      this.failuresLeft = failures;
    }
    send(mail: OutgoingMail): Promise<void> {
      if (this.failuresLeft > 0) {
        this.failuresLeft--;
        return Promise.reject(new Error("SMTP 421 try again later"));
      }
      this.sent.push(mail);
      return Promise.resolve();
    }
  }

  const facts = {
    flatLabel: "B-402",
    visitorName: "Ravi <Kumar>",
    plate: "MH12DE1433",
    category: "delivery",
    expectedExitAt: T,
  };

  it("queues each key once and renders HTML + text, escaped", async () => {
    const message = templates.overstayResident(facts);
    expect(message.text).toContain("Ravi <Kumar>");
    expect(message.html).toContain("Ravi &lt;Kumar&gt;");
    expect(message.html).not.toContain("<Kumar>");
    expect(message.text).toMatch(/IST/);
    const first = await prisma.$transaction((tx) =>
      queueEmail(tx, { kind: "t", to: "a@example.com", key: "k1", message }),
    );
    const again = await prisma.$transaction((tx) =>
      queueEmail(tx, { kind: "t", to: "a@example.com", key: "k1", message }),
    );
    expect([first, again]).toEqual([true, false]);
  });

  it("sends due emails and marks them sent", async () => {
    await prisma.$transaction((tx) =>
      queueEmail(tx, {
        kind: "t",
        to: "a@example.com",
        key: "k1",
        message: templates.visitApproved(facts),
        at: at(0),
      }),
    );
    const mailer = new FakeMailer();
    expect(await dispatchDue(mailer, at(0))).toEqual({ sent: 1, retrying: 0, failed: 0 });
    expect(mailer.sent[0]).toMatchObject({
      to: "a@example.com",
      subject: "Your visit to B-402 is approved",
    });
    expect(mailer.sent[0]?.html).toContain("<h2");
    expect(await prisma.notification.findFirstOrThrow()).toMatchObject({
      status: "sent",
      attempts: 1,
    });
    expect(await dispatchDue(mailer, at(1))).toEqual({ sent: 0, retrying: 0, failed: 0 });
  });

  it("retries with backoff 1, 2, 4, 8 minutes, then gives up after 5 attempts with the error", async () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(backoffMinutes)).toEqual([1, 2, 4, 8, 16, 32, 60, 60]);
    await prisma.$transaction((tx) =>
      queueEmail(tx, {
        kind: "t",
        to: "a@example.com",
        key: "k1",
        message: templates.visitApproved(facts),
        at: at(0),
      }),
    );
    const mailer = new FakeMailer(99);
    let now = at(0);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      expect(await dispatchDue(mailer, at(-1))).toEqual({ sent: 0, retrying: 0, failed: 0 }); // not yet due
      const r = await dispatchDue(mailer, now);
      expect(r).toEqual(
        attempt < MAX_ATTEMPTS
          ? { sent: 0, retrying: 1, failed: 0 }
          : { sent: 0, retrying: 0, failed: 1 },
      );
      const row = await prisma.notification.findFirstOrThrow();
      expect(row.attempts).toBe(attempt);
      expect(row.nextAttemptAt.getTime() - now.getTime()).toBe(backoffMinutes(attempt) * MIN);
      now = row.nextAttemptAt;
    }
    expect(await prisma.notification.findFirstOrThrow()).toMatchObject({
      status: "failed",
      lastError: "SMTP 421 try again later",
    });
  });

  it("two dispatchers at once never send the same email twice", async () => {
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < 12; i++) {
        await queueEmail(tx, {
          kind: "t",
          to: `p${String(i)}@example.com`,
          key: `k${String(i)}`,
          message: templates.visitApproved(facts),
          at: at(0),
        });
      }
    });
    const a = new FakeMailer();
    const b = new FakeMailer();
    await Promise.all([dispatchDue(a, at(0)), dispatchDue(b, at(0))]);
    const recipients = [...a.sent, ...b.sent].map((m) => m.to).sort();
    expect(recipients).toHaveLength(12);
    expect(new Set(recipients).size).toBe(12);
  });
});

describe("reconciliation", () => {
  async function residentCarEvents() {
    const gate = await prisma.gate.create({ data: { name: "Main gate" } });
    const device = await prisma.device.create({
      data: {
        gateId: gate.id,
        name: "cam",
        direction: "entry",
        apiKeyHash: "h",
        apiKeyPrefix: "vd_x",
      },
    });
    const car = await prisma.vehicle.create({
      data: { flatId, plateRaw: "UP16AB1234", plateNormalized: "UP16AB1234", vehicleType: "car" },
    });
    let n = 0;
    const event = (direction: "entry" | "exit", minutes: number) =>
      prisma.gateEvent.create({
        data: {
          deviceId: device.id,
          gateId: gate.id,
          direction,
          plateRaw: "UP16AB1234",
          plateNormalized: "UP16AB1234",
          confidence: 0.95,
          capturedAt: at(minutes),
          lastSeenAt: at(minutes),
          eventHash: `h${String(n++)}`,
          matchResult: "resident",
          vehicleId: car.id,
        },
      });
    return { event };
  }

  it("flags an exit with no entry, a superseded open entry, and a stale visit, each once", async () => {
    const { event } = await residentCarEvents();
    const lonelyExit = await event("exit", -300);
    const forgottenEntry = await event("entry", -200);
    await event("entry", -100); // the car's current, normal open entry: not flagged
    const stale = await visitInsideUntilT();

    const now = at(25 * 60);
    expect(await runReconciliation(now)).toEqual({
      exitWithoutEntry: 1,
      entryNeverClosed: 1,
      staleVisit: 1,
    });
    expect(await runReconciliation(now)).toEqual({
      exitWithoutEntry: 0,
      entryNeverClosed: 0,
      staleVisit: 0,
    });

    const flags = await prisma.reconciliationFlag.findMany();
    expect(flags.map((f) => `${f.kind}:${f.subjectId}`).sort()).toEqual(
      [
        `entry_never_closed:${forgottenEntry.id}`,
        `exit_without_entry:${lonelyExit.id}`,
        `stale_visit:${stale.id}`,
      ].sort(),
    );
  });

  it("a visit only a few hours late is not stale yet", async () => {
    await visitInsideUntilT();
    expect((await runReconciliation(at(5 * 60))).staleVisit).toBe(0);
  });
});

describe("retention", () => {
  const DAY = 86_400_000;

  it("erases old visitors' personal data (not while a visit is open), redacts old emails, deletes old snapshots", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 100 * DAY);
    const oldVisitor = await prisma.visitor.create({
      data: {
        fullName: "Old Guest",
        phone: "+919800000000",
        email: "old@example.com",
        createdAt: old,
      },
    });
    const openVisitor = await prisma.visitor.create({
      data: { fullName: "Still Inside", createdAt: old },
    });
    const recent = await prisma.visitor.create({ data: { fullName: "New Guest" } });
    await prisma.$transaction(async (tx) => {
      const v = await createVisit(tx, {
        flatId,
        category: "guest",
        status: "approved",
        visitorId: openVisitor.id,
      });
      await transitionVisit(tx, v.id, "enter", { at: now });
    });
    await prisma.notification.create({
      data: {
        channel: "email",
        kind: "t",
        recipient: "old@example.com",
        bodyText: "hi",
        status: "sent",
        idempotencyKey: "old",
        createdAt: old,
      },
    });

    const gate = await prisma.gate.create({ data: { name: "G" } });
    const device = await prisma.device.create({
      data: { gateId: gate.id, name: "c", direction: "entry", apiKeyHash: "h2", apiKeyPrefix: "p" },
    });
    const dir = process.env.SNAPSHOT_LOCAL_DIR ?? "";
    await rm(dir, { recursive: true, force: true });
    const eventId = crypto.randomUUID();
    const key = snapshotKey(eventId, old, "jpg");
    await saveSnapshot(key, Buffer.from([0xff, 0xd8, 0xff]));
    await prisma.gateEvent.create({
      data: {
        id: eventId,
        deviceId: device.id,
        gateId: gate.id,
        direction: "entry",
        plateRaw: "X",
        plateNormalized: "X",
        confidence: 0.9,
        capturedAt: old,
        lastSeenAt: old,
        eventHash: "e1",
        matchResult: "unknown",
        snapshotKey: key,
      },
    });

    expect(await runRetention(now)).toEqual({
      visitorsPurged: 1,
      notificationsRedacted: 1,
      snapshotsDeleted: 1,
    });
    expect(await prisma.visitor.findUniqueOrThrow({ where: { id: oldVisitor.id } })).toMatchObject({
      fullName: null,
      phone: null,
      email: null,
    });
    expect(
      (await prisma.visitor.findUniqueOrThrow({ where: { id: openVisitor.id } })).fullName,
    ).toBe("Still Inside");
    expect((await prisma.visitor.findUniqueOrThrow({ where: { id: recent.id } })).fullName).toBe(
      "New Guest",
    );
    expect(await prisma.notification.findFirstOrThrow()).toMatchObject({
      recipient: "[redacted]",
      bodyText: "[redacted]",
    });
    expect(
      (await prisma.gateEvent.findUniqueOrThrow({ where: { id: eventId } })).snapshotKey,
    ).toBeNull();
    const files = await readdir(dir, { recursive: true, withFileTypes: true });
    expect(files.filter((f) => f.isFile())).toHaveLength(0);

    expect(await runRetention(now)).toEqual({
      visitorsPurged: 0,
      notificationsRedacted: 0,
      snapshotsDeleted: 0,
    });
  });
});

describe("APIs: escalations, reconciliation, notifications, approval email", () => {
  it("guards see full phones on call tasks and record the outcome once", async () => {
    const resident = await prisma.user.findFirstOrThrow({ where: { role: "resident" } });
    await prisma.user.update({ where: { id: resident.id }, data: { phone: "+919811122233" } });
    await visitInsideUntilT();
    await runLadder(at(61));
    const guard = await tokenFor((await createUser("guard")).id);
    const api = (m: "get" | "post", url: string, body?: object) =>
      request(app)[m](url).set("Authorization", `Bearer ${guard}`).send(body);

    const list = await api("get", "/api/escalations?status=open");
    expect(list.body.items[0]).toMatchObject({
      status: "open",
      visit: { flatLabel: "B-402", plate: "MH12DE1433", visitorName: "Ravi Kumar" },
      residents: [{ phone: "+919811122233" }],
    });
    const id = list.body.items[0].id as string;
    const done = await api("post", `/api/escalations/${id}/resolve`, {
      outcome: "reached",
      notes: "Guest leaving in 5 min",
    });
    expect(done.body).toMatchObject({ status: "resolved", outcome: "reached" });
    expect(
      (await api("post", `/api/escalations/${id}/resolve`, { outcome: "not_reached" })).status,
    ).toBe(409);
  });

  it("admins list and resolve findings, and read the delivery log", async () => {
    const admin = await tokenFor((await createUser("admin")).id);
    const api = (m: "get" | "post", url: string) =>
      request(app)[m](url).set("Authorization", `Bearer ${admin}`);
    await visitInsideUntilT();
    await runReconciliation(at(30 * 60));
    await runLadder(at(1));
    const flags = await api("get", "/api/reconciliation?resolved=false");
    expect(flags.body.items[0].kind).toBe("stale_visit");
    expect(
      (await api("post", `/api/reconciliation/${String(flags.body.items[0].id)}/resolve`)).status,
    ).toBe(204);
    expect(
      (await api("post", `/api/reconciliation/${String(flags.body.items[0].id)}/resolve`)).status,
    ).toBe(409);
    expect((await api("get", "/api/reconciliation?resolved=false")).body.total).toBe(0);
    const log = await api("get", "/api/notifications?kind=overstay");
    expect(log.body.total).toBe(2);
    expect(log.body.items[0]).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("approving a visitor queues the 'visit approved' email to them", async () => {
    const guard = await tokenFor((await createUser("guard")).id);
    const residentToken = await tokenFor(
      (await prisma.user.findFirstOrThrow({ where: { role: "resident" } })).id,
    );
    const reg = await request(app)
      .post("/api/visits")
      .set("Authorization", `Bearer ${guard}`)
      .send({
        flatId,
        category: "guest",
        visitor: { fullName: "Meera", email: "meera@example.com" },
      });
    await request(app)
      .post(`/api/approvals/${String(reg.body.approval.id)}/decision`)
      .set("Authorization", `Bearer ${residentToken}`)
      .send({ decision: "approve" });
    const email = await prisma.notification.findFirstOrThrow({ where: { kind: "visit_approved" } });
    expect(email).toMatchObject({
      recipient: "meera@example.com",
      subject: "Your visit to B-402 is approved",
    });
  });
});
