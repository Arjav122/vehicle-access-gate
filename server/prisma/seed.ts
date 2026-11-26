// Seed a made-up society: "Green Valley Residency, Greater Noida".
//   npm run seed                         → fills an empty database
//   npm run seed -- --reset              → wipes all data first
//   npm run seed -- --reset --no-history → people, flats, cars and cameras only (fast; CI)
// The demo reset (POST /api/demo/reset, nightly at 04:00 IST in demo mode) calls seedSociety().
// Same people and plates every run (fixed random seed). Demo logins use DEMO_PASSWORD:
//   admin@example.com, guard@example.com, resident@example.com
// Camera device keys are printed once; only their hashes are stored.
// Safety: refuses to touch a database that is not on this machine / in docker compose
// unless --allow-remote is passed.
//
// People, flats, vehicles, gates, devices and the watchlist, then 14 days of closed history
// plus a small "right now" state, both relative to the moment you run it. History goes through
// the same services the API uses (camera reads → ingestRead, guard registration, resident
// answers), so the scheduled jobs find nothing left to repeat.
import { pathToFileURL } from "node:url";
import { hashPassword } from "../src/services/auth.js";
import { prisma, withTx } from "../src/db.js";
import { config } from "../src/config.js";
import { newDeviceKey } from "../src/routes/devices.js";
import { istDate } from "../src/services/analytics.js";
import { guardDecides, requestApproval, residentDecides } from "../src/services/approvals.js";
import { ingestRead, reviewEvent } from "../src/services/gateEvents.js";
import { hashCode, newCode } from "../src/services/guestPasses.js";
import { normalizePlate } from "../src/services/plates.js";
import { registerVisit, transitionVisit } from "../src/services/visits.js";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "postgres", "::1"]);

// ---------- Deterministic random numbers (mulberry32) ----------
const SEED = 20_261_125;
let state = SEED;
function random(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const between = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));

// ---------- Made-up but realistic data ----------
const FIRST = [
  "Aarav",
  "Vivaan",
  "Aditya",
  "Arjun",
  "Rohan",
  "Kabir",
  "Ishaan",
  "Rahul",
  "Siddharth",
  "Karan",
  "Ananya",
  "Diya",
  "Priya",
  "Kavya",
  "Meera",
  "Neha",
  "Pooja",
  "Riya",
  "Sneha",
  "Tanvi",
  "Amit",
  "Deepak",
  "Manish",
  "Suresh",
  "Vikram",
  "Anjali",
  "Shalini",
  "Sunita",
  "Rekha",
  "Nisha",
];
const LAST = [
  "Sharma",
  "Verma",
  "Gupta",
  "Singh",
  "Agarwal",
  "Mehta",
  "Iyer",
  "Nair",
  "Reddy",
  "Kapoor",
  "Malhotra",
  "Chauhan",
  "Yadav",
  "Joshi",
  "Bansal",
  "Saxena",
  "Mishra",
  "Pandey",
  "Bhatia",
  "Rao",
];
const CARS = [
  "Maruti Swift",
  "Maruti Baleno",
  "Hyundai Creta",
  "Hyundai i20",
  "Tata Nexon",
  "Tata Punch",
  "Mahindra XUV700",
  "Kia Seltos",
  "Honda City",
  "Toyota Innova Crysta",
];
const TWO_WHEELERS = [
  "Honda Activa",
  "TVS Jupiter",
  "Royal Enfield Classic 350",
  "Bajaj Pulsar",
  "Hero Splendor",
];
const COLOURS = ["White", "Silver", "Grey", "Black", "Red", "Blue"];
const SERIES_LETTERS = Array.from("ABCDEFGHJKLMNPRSTUVWXYZ"); // no I, O, Q

/** A valid plate from the NCR region (mostly UP16 / UP14, some DL, HR and BH). */
function randomPlate(): string {
  const letters = (n: number) => Array.from({ length: n }, () => pick(SERIES_LETTERS)).join("");
  const digits = (n: number) => String(between(1, 10 ** n - 1)).padStart(n, "0");
  const roll = random();
  if (roll < 0.1) return `${String(between(21, 25))}BH${digits(4)}${letters(2)}`;
  if (roll < 0.25) return `DL${String(between(1, 14))}C${letters(2)}${digits(4)}`;
  if (roll < 0.35) return `HR${pick(["26", "51", "29"])}${letters(2)}${digits(4)}`;
  return `UP${pick(["16", "14"])}${letters(2)}${digits(4)}`;
}

function personEmail(first: string, last: string, used: Set<string>): string {
  const base = `${first}.${last}`.toLowerCase();
  let email = `${base}@example.com`;
  for (let n = 2; used.has(email); n++) email = `${base}${String(n)}@example.com`;
  used.add(email);
  return email;
}

const phone = () => `+91${String(between(7, 9))}${String(between(100_000_000, 999_999_999))}`;

// ---------- Seeding ----------

/** Postgres "deadlock detected" (SQLSTATE 40P01), however the driver wraps it. */
export function isDeadlock(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${JSON.stringify(err)}` : String(err);
  return /40P01|deadlock detected/i.test(text);
}

/**
 * Run `fn`, retrying a few times if Postgres picks it as a deadlock victim. A demo reset
 * TRUNCATEs every table while the simulator (or a person) may be writing; Postgres then
 * aborts one side, and the reset should simply try again rather than fail.
 */
export async function retryOnDeadlock<T>(
  fn: () => Promise<T>,
  attempts = 5,
  waitMs = 250,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isDeadlock(err)) throw err;
      await new Promise((r) => setTimeout(r, waitMs * i));
    }
  }
}

/** Empty every table except Prisma's migration history. Returns how many tables. */
export async function emptyDatabase(): Promise<number> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await retryOnDeadlock(() =>
    prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`),
  );
  return tables.length;
}

export interface SeedSummary {
  flats: number;
  residents: number;
  vehicles: number;
  watchlist: number;
  /** "  Main gate entry camera   vd_…" lines: shown once by the CLI, never stored. */
  deviceKeys: string[];
  history: { events: number; visits: number; guestCode: string } | null;
}

/**
 * Fill an EMPTY database with the demo society. `history: false` skips the 14 days of
 * history and the "right now" state (seconds instead of a minute and a half).
 */
export async function seedSociety(
  opts: { history?: boolean; now?: Date } = {},
): Promise<SeedSummary> {
  if (!config.DEMO_PASSWORD)
    throw new Error("Set DEMO_PASSWORD (see .env.example) before seeding.");
  if ((await prisma.user.count()) > 0)
    throw new Error("The database already has data. Run `npm run seed -- --reset` to start over.");
  state = SEED; // same people and plates every run, also on a demo reset in a long-lived server

  // One hash for every demo account: argon2 is slow on purpose, and these share a password.
  const passwordHash = await hashPassword(config.DEMO_PASSWORD);
  const usedEmails = new Set(["admin@example.com", "guard@example.com", "resident@example.com"]);

  // Staff.
  await prisma.user.create({
    data: {
      email: "admin@example.com",
      fullName: "Rakesh Khanna (Secretary)",
      phone: phone(),
      role: "admin",
      passwordHash,
    },
  });
  await prisma.user.createMany({
    data: [
      {
        email: "guard@example.com",
        fullName: "Ramesh Kumar",
        phone: phone(),
        role: "guard",
        passwordHash,
      },
      {
        email: "suresh.yadav.guard@example.com",
        fullName: "Suresh Yadav",
        phone: phone(),
        role: "guard",
        passwordHash,
      },
      {
        email: "mohan.lal.guard@example.com",
        fullName: "Mohan Lal",
        phone: phone(),
        role: "guard",
        passwordHash,
      },
    ],
  });

  // 40 flats: blocks A–D, floors 1–5, two flats per floor (A-101, A-102 … D-502).
  const flats = [];
  for (const block of ["A", "B", "C", "D"]) {
    for (let floor = 1; floor <= 5; floor++) {
      for (let n = 1; n <= 2; n++) {
        flats.push(
          await prisma.flat.create({
            data: { block, number: `${String(floor)}0${String(n)}`, floor },
          }),
        );
      }
    }
  }

  // Residents: one primary contact per flat, plus family in half the flats (~60 people).
  let residents = 0;
  for (const [i, flat] of flats.entries()) {
    const last = pick(LAST);
    const people: { first: string; type: "owner" | "tenant" | "family"; primary: boolean }[] = [
      { first: pick(FIRST), type: random() < 0.75 ? "owner" : "tenant", primary: true },
    ];
    if (i % 2 === 0) people.push({ first: pick(FIRST), type: "family", primary: false });

    for (const [j, p] of people.entries()) {
      const demo = i === 0 && j === 0; // A-101's primary contact is the demo resident
      const user = await prisma.user.create({
        data: {
          email: demo ? "resident@example.com" : personEmail(p.first, last, usedEmails),
          fullName: demo ? "Priya Sharma" : `${p.first} ${last}`,
          phone: phone(),
          role: "resident",
          passwordHash,
        },
      });
      await prisma.resident.create({
        data: {
          userId: user.id,
          flatId: flat.id,
          residentType: p.type,
          isPrimaryContact: p.primary,
        },
      });
      residents++;
    }
  }

  // Vehicles: 1–3 per flat (~80), every plate valid and unique.
  const plates = new Set<string>();
  let vehicles = 0;
  for (const flat of flats) {
    for (let k = 0, count = between(1, 3); k < count; k++) {
      let plate = randomPlate();
      while (plates.has(plate) || !normalizePlate(plate)) plate = randomPlate();
      plates.add(plate);
      const twoWheeler = random() < 0.3;
      await prisma.vehicle.create({
        data: {
          flatId: flat.id,
          plateRaw: plate,
          plateNormalized: plate,
          vehicleType: twoWheeler ? "two_wheeler" : "car",
          makeModel: pick(twoWheeler ? TWO_WHEELERS : CARS),
          colour: pick(COLOURS),
        },
      });
      vehicles++;
    }
  }

  // Gates and their cameras. Keys are shown once, here.
  const keys: string[] = [];
  const lanes: Lane[] = [];
  for (const gateName of ["Main gate", "Service gate"]) {
    const gate = await prisma.gate.create({ data: { name: gateName } });
    for (const direction of ["entry", "exit"] as const) {
      const { key, hash, prefix } = newDeviceKey();
      const name = `${gateName} ${direction} camera`;
      const device = await prisma.device.create({
        data: { gateId: gate.id, name, direction, apiKeyHash: hash, apiKeyPrefix: prefix },
      });
      lanes.push({ deviceId: device.id, gateId: gate.id, direction });
      keys.push(`  ${name.padEnd(28)} ${key}`);
    }
  }

  // Watchlist.
  const watch = [
    {
      plate: "UP16BT4411",
      reason: "Reported for reckless driving inside the society (RWA notice 12/2026)",
    },
    { plate: "DL8CAF7203", reason: "Former contractor; entry banned by the managing committee" },
    { plate: "HR26DK0091", reason: "Vehicle reported stolen to Noida Sector 39 police" },
  ];
  for (const w of watch) {
    await prisma.watchlistEntry.create({
      data: { plateRaw: w.plate, plateNormalized: w.plate, reason: w.reason },
    });
  }

  const history = opts.history === false ? null : await seedHistory(lanes, opts.now ?? new Date());
  return {
    flats: flats.length,
    residents,
    vehicles,
    watchlist: watch.length,
    deviceKeys: keys,
    history,
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const host = new URL(config.DATABASE_URL).hostname;
  if (!LOCAL_HOSTS.has(host) && !args.has("--allow-remote")) {
    throw new Error(
      `Refusing to seed ${host}: not a local database. Pass --allow-remote if you really mean it.`,
    );
  }
  if (args.has("--reset")) console.log(`Reset: emptied ${String(await emptyDatabase())} tables.`);
  const s = await seedSociety({ history: !args.has("--no-history") });
  const history = s.history
    ? `History: ${String(s.history.events)} camera reads and ${String(s.history.visits)} visits over 14 days, plus "right now".

Guest pass code for A-101 (shown only now): ${s.history.guestCode}`
    : "No history (--no-history).";

  console.log(`
Seeded "Green Valley Residency, Greater Noida":
  ${String(s.flats)} flats, ${String(s.residents)} residents, ${String(s.vehicles)} vehicles, 3 guards, 1 admin,
  2 gates with 4 camera devices, ${String(s.watchlist)} watchlist plates.
  ${history}

Demo logins (password = DEMO_PASSWORD):
  admin@example.com · guard@example.com · resident@example.com (A-101)

Camera device keys (shown only now; store them on the cameras):
${s.deviceKeys.join("\n")}
`);
}

// ---------- 14 days of history + "right now" ----------

interface Lane {
  deviceId: string;
  gateId: string;
  direction: "entry" | "exit";
}

const MIN = 60_000;
type Category = "guest" | "delivery" | "cab" | "service";
const LIMITS: Record<Category, number> = {
  guest: config.VISIT_LIMIT_GUEST_MINUTES,
  delivery: config.VISIT_LIMIT_DELIVERY_MINUTES,
  cab: config.VISIT_LIMIT_CAB_MINUTES,
  service: config.VISIT_LIMIT_SERVICE_MINUTES,
};
const PURPOSES: Record<Category, string[]> = {
  guest: ["Family visit", "Birthday dinner", "Friends over", "Parents visiting"],
  delivery: ["Amazon parcel", "Swiggy order", "Zomato order", "Flipkart delivery", "Blinkit"],
  cab: ["Uber drop", "Ola pickup", "Rapido drop"],
  service: ["Plumber", "Electrician", "AC service", "Internet technician", "Carpenter"],
};

/**
 * When the guard registers a visitor: a little after the car arrived, but never after "now".
 * (A car that arrived 30 s ago with a 40–90 s delay would otherwise be registered in the
 * future, and its approval would show more than the 3 minutes residents ever get.)
 */
export function registrationTime(arrival: Date, delaySeconds: number, now: Date): Date {
  return new Date(Math.min(arrival.getTime() + delaySeconds * 1000, now.getTime()));
}

/** Midnight IST of the day `daysAgo` days before `now` (negative = days ahead). */
function istMidnight(now: Date, daysAgo: number): number {
  return Date.parse(`${istDate(new Date(now.getTime() - daysAgo * 86_400_000))}T00:00:00+05:30`);
}

/** A time of day (minutes after midnight) for the 8–10 am rush, the 6–9 pm rush, or daytime. */
function rushMinute(kind: "morning" | "evening" | "day"): number {
  if (kind === "morning") return between(8 * 60, 10 * 60);
  if (kind === "evening") return between(18 * 60, 21 * 60);
  return random() < 0.5 ? between(9 * 60, 13 * 60) : between(14 * 60, 21 * 60 + 30);
}

function pickCategory(): Category {
  const r = random();
  if (r < 0.45) return "delivery";
  if (r < 0.65) return "cab";
  if (r < 0.9) return "guest";
  return "service";
}

interface VisitorOptions {
  answer?: "approve" | "deny" | "timeout";
  /** Minutes inside; null = still inside now. Default: mostly in time, ~1 in 8 overstays. */
  stay?: number | null;
  category?: Category;
  /** The flat being visited (default: random; regular visitors keep their own flat). */
  flatIndex?: number;
}

async function seedHistory(lanes: Lane[], now: Date) {
  const lane = (gate: number, direction: "entry" | "exit") =>
    lanes.filter((l) => l.direction === direction)[gate] as Lane;
  const guards = await prisma.user.findMany({
    where: { role: "guard" },
    orderBy: { email: "asc" },
  });
  const guard = () => pick(guards).id;
  const vehicles = await prisma.vehicle.findMany({ orderBy: { plateNormalized: "asc" } });
  const flats = await prisma.flat.findMany({
    include: { residents: { where: { isPrimaryContact: true } } },
    orderBy: [{ block: "asc" }, { number: "asc" }],
  });
  const residentPlates = new Set(vehicles.map((v) => v.plateNormalized));
  const visitorPlate = () => {
    let p = randomPlate();
    while (residentPlates.has(p) || !normalizePlate(p)) p = randomPlate();
    return p;
  };
  // Regular visitors (the maid's scooter, the family that visits on Sundays) come back.
  const regulars = Array.from({ length: 12 }, () => ({
    plate: visitorPlate(),
    name: `${pick(FIRST)} ${pick(LAST)}`,
    flat: pick(flats),
  }));

  let events = 0;
  let visits = 0;
  const camera = async (l: Lane, plate: string, at: Date, confidence = 0.9 + random() * 0.09) => {
    events++;
    const result = await ingestRead({
      deviceId: l.deviceId,
      gateId: l.gateId,
      direction: l.direction,
      plateText: plate,
      confidence,
      capturedAt: at,
    });
    return result.event;
  };

  // Every car starts the story parked inside (one entry the evening before the window), so
  // the first morning exit pairs with an entry instead of looking like a missing one.
  for (const v of vehicles) {
    const evening = new Date(istMidnight(now, 15) + rushMinute("evening") * MIN);
    await camera(lane(0, "entry"), v.plateNormalized, evening);
  }

  /** One visitor: camera read → guard registers → answer → (maybe) exit read. */
  async function visitor(arrival: Date, opts: VisitorOptions = {}) {
    const regular = opts.flatIndex === undefined && random() < 0.3 ? pick(regulars) : null;
    const flat =
      regular?.flat ??
      (opts.flatIndex !== undefined ? flats[opts.flatIndex] : undefined) ??
      pick(flats);
    const plate = regular?.plate ?? visitorPlate();
    const category = opts.category ?? pickCategory();
    const gate = category === "delivery" || category === "service" ? 1 : 0;
    const read = await camera(lane(gate, "entry"), plate, arrival);
    if (read.visitId || read.matchResult !== "unknown") return;

    const registeredAt = registrationTime(arrival, between(40, 90), now);
    const visit = await withTx((tx) =>
      registerVisit(
        tx,
        {
          flatId: flat.id,
          category,
          visitor: { fullName: regular?.name ?? `${pick(FIRST)} ${pick(LAST)}`, phone: phone() },
          purpose: pick(PURPOSES[category]),
          gateEventId: read.id,
        },
        guard(),
        registeredAt,
        requestApproval,
      ),
    );
    visits++;

    const answer =
      opts.answer ?? (random() < 0.8 ? "approve" : random() < 0.5 ? "deny" : "timeout");
    const resident = flat.residents[0];
    if (answer === "timeout" || !resident) {
      const late = new Date(registeredAt.getTime() + (config.APPROVAL_TIMEOUT_SECONDS + 20) * 1000);
      if (late > now) return; // the resident can still answer
      await guardDecides(visit.id, guard(), random() < 0.85 ? "approve" : "deny", late);
    } else {
      const approval = await prisma.approval.findUniqueOrThrow({ where: { visitId: visit.id } });
      const answeredAt = new Date(registeredAt.getTime() + between(15, 150) * 1000);
      if (answeredAt > now) return; // still waiting: shows up on the resident's phone
      await residentDecides(approval.id, resident.userId, answer, "web", answeredAt);
    }

    const after = await prisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
    if (after.status !== "inside" || !after.enteredAt || opts.stay === null) return;
    const limit = LIMITS[category];
    const overstays = opts.stay === undefined ? random() < 0.12 : opts.stay > limit;
    const stay =
      opts.stay ??
      (overstays
        ? limit + between(10, 50)
        : Math.max(3, Math.round(limit * (0.3 + random() * 0.6))));
    const leave = new Date(after.enteredAt.getTime() + stay * MIN);
    if (leave > now) return;
    const expected = after.expectedExitAt;
    if (overstays && expected) {
      await withTx((tx) => transitionVisit(tx, visit.id, "overstay", { at: expected }));
    }
    await camera(lane(gate, "exit"), plate, leave);
  }

  const cutoff = now.getTime() - 4 * 60 * MIN; // the last 4 hours are the "right now" state
  for (let d = 14; d >= 0; d--) {
    const midnight = istMidnight(now, d);
    const at = (minute: number) => new Date(midnight + minute * MIN);

    // Resident cars: out in the morning rush, back in the evening.
    for (const v of vehicles) {
      if (random() > 0.45) continue;
      const out = at(rushMinute("morning"));
      const back = at(rushMinute("evening"));
      if (out.getTime() > cutoff) continue;
      await camera(lane(0, "exit"), v.plateNormalized, out);
      if (back.getTime() <= cutoff) await camera(lane(0, "entry"), v.plateNormalized, back);
    }

    // Visitors: 10–16 a day.
    for (let k = 0, n = between(10, 16); k < n; k++) {
      const roll = random();
      const kind = roll < 0.2 ? "morning" : roll < 0.4 ? "evening" : "day";
      const arrival = at(rushMinute(kind));
      if (arrival.getTime() <= cutoff) await visitor(arrival);
    }

    // A blurry read now and then, settled by the guard a couple of minutes later.
    for (let k = 0; k < 2; k++) {
      const when = at(rushMinute("day"));
      if (when.getTime() > cutoff) continue;
      const v = pick(vehicles);
      const blurry = await camera(
        lane(0, "entry"),
        v.plateNormalized.slice(0, -1) + "?",
        when,
        0.42 + random() * 0.3,
      );
      if (blurry.needsReview) {
        const fixedAt = new Date(when.getTime() + 2 * MIN);
        await reviewEvent(
          blurry.id,
          guard(),
          { action: "correct", plate: v.plateNormalized },
          fixedAt,
        );
      }
    }

    // A watchlisted car tries the gate every few days; the guard acknowledges the alert.
    if (d % 4 === 2) {
      const when = at(rushMinute("day"));
      if (when.getTime() > cutoff) continue;
      const hit = await camera(lane(0, "entry"), pick(["UP16BT4411", "HR26DK0091"]), when);
      await prisma.alert.updateMany({
        where: { gateEventId: hit.id },
        data: { acknowledgedAt: new Date(when.getTime() + 3 * MIN), acknowledgedById: guard() },
      });
    }
  }

  // ---------- Right now ----------
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MIN);
  // Inside, in time.
  await visitor(ago(8), { category: "delivery", answer: "approve", stay: null });
  await visitor(ago(70), { category: "guest", answer: "approve", stay: null });
  await visitor(ago(150), { category: "service", answer: "approve", stay: null });
  // Past the limit: the escalation job sends the overstay emails and creates the call task.
  await visitor(ago(LIMITS.cab + 40), { category: "cab", answer: "approve", stay: null });
  await visitor(ago(LIMITS.delivery + 75), { category: "delivery", answer: "approve", stay: null });
  // Waiting for the demo resident of A-101 (the approval runs out about 3 minutes after seeding).
  await visitor(ago(0.5), { category: "guest", flatIndex: 0 });
  // An unknown car at the barrier that the guard has not registered yet.
  await camera(lane(0, "entry"), visitorPlate(), ago(1.5));
  // Two unclear reads in the review queue.
  await camera(lane(0, "entry"), "UP16 A? 12?4", ago(4), 0.46);
  await camera(lane(1, "entry"), "HR2? DK 00", ago(12), 0.38);
  // A watchlist hit nobody has acknowledged yet.
  await camera(lane(0, "entry"), "DL8CAF7203", ago(25), 0.71);

  // A guest pass for the demo resident (A-101): by code, valid until 2 am tomorrow.
  const demoResident = flats[0]?.residents[0];
  const guestCode = newCode();
  if (demoResident) {
    await prisma.guestPass.create({
      data: {
        flatId: demoResident.flatId,
        createdById: demoResident.userId,
        guestName: "Anjali Mehta (sister)",
        codeHash: hashCode(guestCode),
        validFrom: ago(60),
        validUntil: new Date(istMidnight(now, -1) + 2 * 60 * MIN),
        maxUses: 2,
      },
    });
  }
  return { events, visits, guestCode };
}

// Run only as a script (`tsx prisma/seed.ts`), not when the demo reset imports this file.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main()
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
