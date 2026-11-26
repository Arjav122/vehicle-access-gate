// Phase 7: the demo traffic simulator. Pure parts (traffic pattern, arrival shares, plates,
// flags) and a real run against the API on a local port: it must create gate events, visits
// and approvals through the public API, leave real webcam devices alone, and start over by
// itself after a demo reset.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDatabase, seedSociety } from "../prisma/seed.js";
import { config } from "../src/config.js";
import { prisma } from "../src/db.js";
import { createApp } from "../src/index.js";
import { runDemoReset } from "../src/routes/demo.js";
import { newDeviceKey } from "../src/routes/devices.js";
import { normalizePlate } from "../src/services/plates.js";
import {
  arrivalsPerMinute,
  blurPlate,
  istHour,
  kindFor,
  makeRandom,
  parseArgs,
  randomPlate,
  runSimulator,
} from "../src/simulator.js";

describe("traffic pattern", () => {
  it("is busiest in the two rush hours and quiet at night", () => {
    expect(arrivalsPerMinute(9)).toBeGreaterThan(arrivalsPerMinute(14));
    expect(arrivalsPerMinute(19)).toBeGreaterThan(arrivalsPerMinute(14));
    expect(arrivalsPerMinute(14)).toBeGreaterThan(arrivalsPerMinute(22));
    expect(arrivalsPerMinute(22)).toBeGreaterThan(arrivalsPerMinute(3));
  });

  it("uses India time", () => {
    expect(istHour(new Date("2026-11-26T03:00:00Z"))).toBe(8); // 08:30 IST
    expect(istHour(new Date("2026-11-26T18:45:00Z"))).toBe(0); // 00:15 IST
  });

  it("splits arrivals roughly 50 / 30 / 7 / 10 / 3", () => {
    const random = makeRandom(42);
    const counts: Record<string, number> = {};
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const k = kindFor(random());
      counts[k] = (counts[k] ?? 0) + 1;
    }
    const share = (k: string) => (counts[k] ?? 0) / n;
    expect(share("resident")).toBeCloseTo(0.5, 1);
    expect(share("visitor")).toBeCloseTo(0.3, 1);
    expect(share("guest_pass")).toBeCloseTo(0.07, 1);
    expect(share("blurry")).toBeCloseTo(0.1, 1);
    expect(share("watchlist")).toBeCloseTo(0.03, 1);
  });

  it("is repeatable for the same seed", () => {
    const a = makeRandom(7);
    const b = makeRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("plates", () => {
  it("makes plates the server accepts as valid Indian plates", () => {
    const random = makeRandom(1);
    for (let i = 0; i < 500; i++) {
      const plate = randomPlate(random);
      expect(normalizePlate(plate), plate).toBe(plate);
    }
  });

  it("blurs a plate the way a camera misreads one", () => {
    const random = makeRandom(3);
    for (let i = 0; i < 50; i++) {
      const blurred = blurPlate("UP16AB1234", random);
      expect(blurred).not.toBe("UP16AB1234");
      expect(blurred.length).toBeLessThanOrEqual(10);
    }
  });
});

describe("flags", () => {
  it("reads flags and environment", () => {
    const o = parseArgs(
      ["--api", "http://x:4000/", "--speed", "5", "--seed", "9", "--minutes", "2", "--rate", "3"],
      { DEMO_PASSWORD: "p" },
    );
    expect(o).toMatchObject({
      api: "http://x:4000",
      speed: 5,
      seed: 9,
      minutes: 2,
      rate: 3,
      password: "p",
      leaveDevices: ["laptop webcam"],
    });
    expect(
      parseArgs(["--leave-devices", "Gate Cam, Lobby"], { SIM_PASSWORD: "p" }).leaveDevices,
    ).toEqual(["gate cam", "lobby"]);
  });

  it("refuses to start without a password or with a bad speed", () => {
    expect(() => parseArgs([], {})).toThrow(/PASSWORD/);
    expect(() => parseArgs(["--speed", "0"], { DEMO_PASSWORD: "p" })).toThrow(/speed/);
    expect(() => parseArgs(["--seed", "abc"], { DEMO_PASSWORD: "p" })).toThrow(/seed/);
  });
});

describe("a real run against the API", () => {
  let server: Server;
  let api = "";
  const saved = {
    password: config.DEMO_PASSWORD,
    ip: config.LOGIN_RATE_LIMIT_PER_IP,
    account: config.LOGIN_RATE_LIMIT_PER_ACCOUNT,
  };

  beforeAll(async () => {
    config.DEMO_PASSWORD = "sim-password";
    // The simulator signs in as many residents from one address; real limits stay in force
    // everywhere else (they are tested in auth.test.ts).
    config.LOGIN_RATE_LIMIT_PER_IP = 1000;
    config.LOGIN_RATE_LIMIT_PER_ACCOUNT = 1000;
    await emptyDatabase();
    await seedSociety({ history: false });
    server = createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    api = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    config.DEMO_PASSWORD = saved.password;
    config.LOGIN_RATE_LIMIT_PER_IP = saved.ip;
    config.LOGIN_RATE_LIMIT_PER_ACCOUNT = saved.account;
  });

  it("drives cars, visitors and approvals through the API, leaves the webcam alone, survives a reset", async () => {
    const gate = await prisma.gate.findFirstOrThrow({ where: { name: "Main gate" } });
    const webcamKey = newDeviceKey();
    const webcam = await prisma.device.create({
      data: {
        gateId: gate.id,
        name: "Laptop webcam entry",
        direction: "entry",
        apiKeyHash: webcamKey.hash,
        apiKeyPrefix: webcamKey.prefix,
      },
    });

    const lines: string[] = [];
    const controller = new AbortController();
    const run = runSimulator(
      {
        api,
        speed: 30,
        seed: 3,
        minutes: 1,
        rate: 2,
        leaveDevices: ["laptop webcam"],
        password: "sim-password",
        log: (l) => lines.push(l),
      },
      controller.signal,
    );

    // Let it work, check the webcam was not touched, then reset the demo underneath it.
    await new Promise((r) => setTimeout(r, 15_000));
    const webcamAfter = await prisma.device.findUniqueOrThrow({ where: { id: webcam.id } });
    expect(webcamAfter.apiKeyHash).toBe(webcamKey.hash);
    const before = {
      events: await prisma.gateEvent.count(),
      visits: await prisma.visit.count(),
    };
    expect(before.events).toBeGreaterThan(0);

    await runDemoReset({ history: false });
    await new Promise((r) => setTimeout(r, 20_000));
    controller.abort();
    const summary = await run;

    expect(summary.reads).toBeGreaterThan(10);
    expect(summary.visits).toBeGreaterThan(0);
    expect(summary.approvals).toBeGreaterThan(0);
    expect(summary.restarts).toBeGreaterThanOrEqual(1);
    // After the reset it carried on with fresh keys: new reads exist in the new data.
    expect(await prisma.gateEvent.count()).toBeGreaterThan(0);
    expect(lines.some((l) => l.startsWith("ready:"))).toBe(true);
    expect(summary.errors).toBeLessThan(summary.reads / 2);
  }, 90_000);
});
