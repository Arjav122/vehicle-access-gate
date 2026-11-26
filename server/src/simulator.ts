// Demo traffic simulator (brief §13): keeps the demo looking alive by acting out a day at the
// gate through the PUBLIC API only, exactly like real cameras, guards and residents would.
// It never touches the database and imports nothing that does.
//
//   npm run simulator -- --api http://127.0.0.1:4000 --speed 1 --seed 7 --minutes 0
//
//   --api            API base URL (default SIM_API_URL or http://127.0.0.1:4000)
//   --speed          how much faster than real life arrivals and reactions happen (default 1).
//                    Overstays always last real minutes, so the real escalation ladder runs.
//   --seed           random seed (default 1): same seed, same sequence of choices
//   --minutes        stop after this many real minutes (default 0 = run forever)
//   --rate           fixed arrivals per minute instead of the time-of-day pattern (default: off)
//   --leave-devices  comma-separated camera names never to touch (default "Laptop webcam"):
//                    the simulator rotates the keys of the cameras it uses, which would break a
//                    real webcam demo running next to it
//   password: SIM_PASSWORD or DEMO_PASSWORD (the demo accounts' shared password)
//
// What happens (brief §13): rush hours 8–10 am and 6–9 pm IST; ~50% resident cars in / out;
// ~30% unknown visitors (most approved, some denied, some ignored so the guard decides);
// ~7% guest passes; ~10% blurry reads for the review queue; ~3% watchlist (at most once per
// 45 minutes); some visitors overstay; a simulated guard clears old items. After a demo reset
// (every key and account is re-created) it notices the 401s and starts over.
import { pathToFileURL } from "node:url";

// ---------- Options ----------

export interface SimOptions {
  api: string;
  speed: number;
  seed: number;
  minutes: number;
  /** Fixed arrivals per (simulated) minute; null = follow the time of day. */
  rate: number | null;
  leaveDevices: string[];
  password: string;
  /** Log lines (default console.log); tests pass a quiet one. */
  log?: (line: string) => void;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): SimOptions {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (flag: string, fallback: number) => {
    const v = get(flag);
    const n = v === undefined ? fallback : Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} must be a number >= 0`);
    return n;
  };
  const password = env.SIM_PASSWORD ?? env.DEMO_PASSWORD ?? "";
  if (!password) throw new Error("Set SIM_PASSWORD or DEMO_PASSWORD (the demo accounts' password)");
  const speed = num("--speed", 1);
  if (speed === 0) throw new Error("--speed must be > 0");
  return {
    api: (get("--api") ?? env.SIM_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, ""),
    speed,
    seed: num("--seed", 1),
    minutes: num("--minutes", 0),
    rate: get("--rate") === undefined ? null : num("--rate", 1),
    leaveDevices: (get("--leave-devices") ?? "Laptop webcam")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    password,
  };
}

// ---------- Pure helpers (unit-tested) ----------

/** Deterministic random numbers (mulberry32). */
export function makeRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hour of the day in India (0–23). */
export function istHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
}

/** Cars arriving per real minute at speed 1: busy in the two rush hours, quiet at night. */
export function arrivalsPerMinute(hour: number): number {
  if ((hour >= 8 && hour < 10) || (hour >= 18 && hour < 21)) return 2;
  if (hour >= 10 && hour < 18) return 0.6;
  if ((hour >= 6 && hour < 8) || (hour >= 21 && hour < 23)) return 0.3;
  return 0.08;
}

export type ArrivalKind = "resident" | "visitor" | "guest_pass" | "blurry" | "watchlist";

/** Which kind of arrival a random number in [0, 1) stands for (brief §13 shares). */
export function kindFor(r: number): ArrivalKind {
  if (r < 0.5) return "resident";
  if (r < 0.8) return "visitor";
  if (r < 0.87) return "guest_pass";
  if (r < 0.97) return "blurry";
  return "watchlist";
}

const SERIES = Array.from("ABCDEFGHJKLMNPRSTUVWXYZ"); // no I, O, Q

/** A valid NCR-style plate (UP16 / UP14 / DL / HR / BH), like the seed's. */
export function randomPlate(random: () => number): string {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)] as T;
  const letters = (n: number) => Array.from({ length: n }, () => pick(SERIES)).join("");
  const digits = (n: number) => String(1 + Math.floor(random() * (10 ** n - 1))).padStart(n, "0");
  const roll = random();
  if (roll < 0.1) return `${String(21 + Math.floor(random() * 5))}BH${digits(4)}${letters(2)}`;
  if (roll < 0.25) return `DL${String(1 + Math.floor(random() * 13))}C${letters(2)}${digits(4)}`;
  if (roll < 0.35) return `HR${pick(["26", "51", "29"])}${letters(2)}${digits(4)}`;
  return `UP${pick(["16", "14"])}${letters(2)}${digits(4)}`;
}

/** How a camera might misread a plate: one character lost or doubted. */
export function blurPlate(plate: string, random: () => number): string {
  const i = 2 + Math.floor(random() * Math.max(1, plate.length - 2));
  return random() < 0.5 ? plate.slice(0, i) + "?" + plate.slice(i + 1) : plate.slice(0, -2);
}

// ---------- HTTP ----------

class ApiFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Session {
  access: string;
  refresh: string;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// ---------- The simulation ----------

interface Lane {
  deviceId: string;
  key: string;
  gate: "main" | "service";
  direction: "entry" | "exit";
}
interface Flat {
  id: string;
  label: string;
  residentEmail: string | null;
}
interface Task {
  at: number;
  label: string;
  run: () => Promise<void>;
}

export interface SimSummary {
  reads: number;
  visits: number;
  approvals: number;
  guardDecisions: number;
  guestPasses: number;
  reviews: number;
  alertsAcknowledged: number;
  callsResolved: number;
  restarts: number;
  errors: number;
}

const VISITOR_NAMES = [
  "Ravi Kumar",
  "Sunil Yadav",
  "Anil Sharma",
  "Pooja Verma",
  "Imran Khan",
  "Deepak Singh",
  "Meena Gupta",
  "Arjun Nair",
  "Kiran Rao",
  "Sanjay Mehta",
  "Neha Bansal",
  "Vikas Chauhan",
];
const PURPOSES = {
  guest: ["Family visit", "Friends over", "Birthday dinner"],
  delivery: ["Amazon parcel", "Swiggy order", "Zomato order", "Blinkit"],
  cab: ["Uber drop", "Ola pickup", "Rapido drop"],
  service: ["Plumber", "Electrician", "AC service"],
} as const;
type Category = keyof typeof PURPOSES;

/** Run until `minutes` have passed (or forever) and return what happened. */
export async function runSimulator(opts: SimOptions, signal?: AbortSignal): Promise<SimSummary> {
  const log =
    opts.log ??
    ((line: string) => {
      console.log(`[simulator] ${line}`);
    });
  const random = makeRandom(opts.seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)] as T;
  /** Like pick, for lists that may be empty (cars, flats, watchlist after an admin's edits). */
  const pickAny = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(random() * xs.length)];
  const between = (lo: number, hi: number) => lo + random() * (hi - lo);
  const scaled = (ms: number) => ms / opts.speed;
  const summary: SimSummary = {
    reads: 0,
    visits: 0,
    approvals: 0,
    guardDecisions: 0,
    guestPasses: 0,
    reviews: 0,
    alertsAcknowledged: 0,
    callsResolved: 0,
    restarts: 0,
    errors: 0,
  };

  // --- state (rebuilt by bootstrap() after a demo reset) ---
  const sessions = new Map<string, Session>();
  let lanes: Lane[] = [];
  let flats: Flat[] = [];
  let residentCars: { plate: string; inside: boolean }[] = [];
  let watchPlates: string[] = [];
  let limits: Record<Category, number> = { guest: 240, delivery: 20, cab: 10, service: 120 };
  let approvalTimeoutSec = 180;
  let generation = 0; // bumps on every bootstrap; tasks from an older generation are dropped
  let lastWatchlistAt = 0;
  const truePlates = new Map<string, string>(); // blurry read id → the plate really there
  let queue: Task[] = [];

  const schedule = (delayMs: number, label: string, run: () => Promise<void>) => {
    const gen = generation;
    queue.push({
      at: Date.now() + delayMs,
      label,
      run: async () => {
        if (gen === generation) await run();
      },
    });
  };

  // --- HTTP helpers ---
  async function http(
    method: string,
    path: string,
    init: { body?: unknown; form?: FormData; token?: string; deviceKey?: string } = {},
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const headers: Record<string, string> = {};
      if (init.token) headers.Authorization = `Bearer ${init.token}`;
      if (init.deviceKey) headers["X-Device-Key"] = init.deviceKey;
      let body: string | FormData | undefined;
      if (init.form) body = init.form;
      else if (init.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(init.body);
      }
      const res = await fetch(opts.api + path, { method, headers, ...(body ? { body } : {}) });
      if (res.status === 429) {
        const wait = Number(res.headers.get("Retry-After") ?? "5");
        await sleep(Math.min(60, Math.max(1, wait)) * 1000);
        continue;
      }
      const text = await res.text();
      const data: unknown = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const detail =
          typeof data === "object" && data && "detail" in data
            ? String(data.detail)
            : res.statusText;
        throw new ApiFailure(res.status, `${method} ${path}: ${String(res.status)} ${detail}`);
      }
      return data;
    }
    throw new ApiFailure(429, `${method} ${path}: still rate limited`);
  }

  async function signIn(email: string): Promise<Session> {
    const pair = (await http("POST", "/api/auth/login", {
      body: { email, password: opts.password },
    })) as { accessToken: string; refreshToken: string };
    const s = { access: pair.accessToken, refresh: pair.refreshToken };
    sessions.set(email, s);
    return s;
  }

  /** A request as `email`: signs in once, refreshes on 401, signs in again if needed. */
  async function as(email: string, method: string, path: string, body?: unknown) {
    const s = sessions.get(email) ?? (await signIn(email));
    try {
      return await http(method, path, { token: s.access, ...(body === undefined ? {} : { body }) });
    } catch (err) {
      if (!(err instanceof ApiFailure) || err.status !== 401) throw err;
      try {
        const pair = (await http("POST", "/api/auth/refresh", {
          body: { refreshToken: s.refresh },
        })) as { accessToken: string; refreshToken: string };
        sessions.set(email, { access: pair.accessToken, refresh: pair.refreshToken });
      } catch {
        await signIn(email); // throws 401 too if the account is gone (demo reset)
      }
      const fresh = sessions.get(email) as Session;
      return http(method, path, { token: fresh.access, ...(body === undefined ? {} : { body }) });
    }
  }
  const admin = (m: string, p: string, b?: unknown) => as("admin@example.com", m, p, b);
  const guard = (m: string, p: string, b?: unknown) => as("guard@example.com", m, p, b);

  async function listAll<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = (await admin(
        "GET",
        `${path}${path.includes("?") ? "&" : "?"}limit=100&offset=${String(offset)}`,
      )) as {
        items: T[];
        total: number;
      };
      items.push(...page.items);
      if (items.length >= page.total || page.items.length === 0) return items;
    }
  }

  /** Post one camera read. Returns the created / matched event. */
  async function camera(
    gate: "main" | "service",
    direction: "entry" | "exit",
    plate: string,
    confidence = between(0.88, 0.99),
  ) {
    const lane =
      lanes.find((l) => l.gate === gate && l.direction === direction) ??
      lanes.find((l) => l.direction === direction);
    if (!lane) throw new Error(`no ${direction} camera`);
    const form = new FormData();
    form.set("plate_text", plate);
    form.set("confidence", confidence.toFixed(3));
    form.set("captured_at", new Date().toISOString());
    const res = (await http("POST", "/api/gate-events", { form, deviceKey: lane.key })) as {
      status: string;
      event: { id: string; visitId: string | null; matchResult: string; needsReview: boolean };
    };
    summary.reads++;
    return res.event;
  }

  // --- start (and start over after a demo reset) ---
  async function bootstrap() {
    generation++;
    queue = [];
    sessions.clear();
    truePlates.clear();
    const devices = await listAll<{
      id: string;
      name: string;
      gateName: string;
      direction: "entry" | "exit";
      isActive: boolean;
    }>("/api/devices");
    const usable = devices.filter(
      (d) => d.isActive && !opts.leaveDevices.some((n) => d.name.toLowerCase().includes(n)),
    );
    lanes = [];
    for (const d of usable) {
      const gate = /service/i.test(d.gateName) ? "service" : "main";
      if (lanes.some((l) => l.gate === gate && l.direction === d.direction)) continue;
      const rotated = (await admin("POST", `/api/devices/${d.id}/rotate-key`)) as {
        apiKey: string;
      };
      lanes.push({ deviceId: d.id, key: rotated.apiKey, gate, direction: d.direction });
    }
    if (!lanes.some((l) => l.direction === "entry") || !lanes.some((l) => l.direction === "exit"))
      throw new Error("Need at least one entry and one exit camera (not in --leave-devices)");

    const flatRows = await listAll<{ id: string; label: string }>("/api/flats");
    const residents = await listAll<{
      flatId: string;
      isPrimaryContact: boolean;
      user: { email: string; isActive: boolean };
    }>("/api/residents?isActive=true");
    flats = flatRows.map((f) => {
      const people = residents.filter((r) => r.flatId === f.id && r.user.isActive);
      const primary = people.find((r) => r.isPrimaryContact) ?? people[0];
      return { id: f.id, label: f.label, residentEmail: primary?.user.email ?? null };
    });
    const vehicles = await listAll<{ plate: string; isActive: boolean }>("/api/vehicles");
    residentCars = vehicles
      .filter((v) => v.isActive)
      .map((v) => ({ plate: v.plate, inside: true }));
    watchPlates = (await listAll<{ plate: string; isActive: boolean }>("/api/watchlist"))
      .filter((w) => w.isActive)
      .map((w) => w.plate);
    const settings = (await admin("GET", "/api/settings")) as {
      guestMinutes: number;
      deliveryMinutes: number;
      cabMinutes: number;
      serviceMinutes: number;
      approvalTimeoutSeconds: number;
    };
    limits = {
      guest: settings.guestMinutes,
      delivery: settings.deliveryMinutes,
      cab: settings.cabMinutes,
      service: settings.serviceMinutes,
    };
    approvalTimeoutSec = settings.approvalTimeoutSeconds;
    log(
      `ready: ${String(lanes.length)} cameras, ${String(flats.length)} flats, ${String(residentCars.length)} resident cars (speed ×${String(opts.speed)})`,
    );
    scheduleNextArrival();
    schedule(scaled(60_000), "guard rounds", guardRounds);
  }

  // --- arrivals ---
  function scheduleNextArrival() {
    const rate = (opts.rate ?? arrivalsPerMinute(istHour(new Date()))) * opts.speed; // per real minute
    const delay = (-Math.log(1 - random()) / rate) * 60_000; // exponential gaps (Poisson arrivals)
    schedule(delay, "arrival", async () => {
      scheduleNextArrival();
      let kind = kindFor(random());
      if (kind === "watchlist" && Date.now() - lastWatchlistAt < 45 * 60_000) kind = "resident";
      await arrival(kind);
    });
  }

  async function arrival(kind: ArrivalKind) {
    if (kind === "resident") {
      const car = pickAny(residentCars);
      if (!car) return;
      await camera("main", car.inside ? "exit" : "entry", car.plate);
      car.inside = !car.inside;
    } else if (kind === "visitor") {
      await visitor();
    } else if (kind === "guest_pass") {
      await guestPass();
    } else if (kind === "blurry") {
      const car = pickAny(residentCars);
      if (!car) return;
      const event = await camera(
        "main",
        car.inside ? "exit" : "entry",
        blurPlate(car.plate, random),
        between(0.35, 0.62),
      );
      car.inside = !car.inside;
      if (event.needsReview) truePlates.set(event.id, car.plate);
    } else {
      const plate = pickAny(watchPlates);
      if (!plate) return;
      lastWatchlistAt = Date.now();
      await camera("main", "entry", plate, between(0.7, 0.95));
      log(`watchlist plate ${plate} at the main gate`);
    }
  }

  /** How long a visitor stays: mostly within the limit (scaled), ~1 in 8 overstays (real time). */
  function stayMs(category: Category): number {
    const limitMs = limits[category] * 60_000;
    if (random() < 0.12) return limitMs + between(20, 75) * 60_000; // real minutes: the ladder runs
    return scaled(limitMs * between(0.3, 0.9));
  }

  async function visitor() {
    const category = pick(["delivery", "delivery", "cab", "guest", "service"] as const);
    const gate = category === "delivery" || category === "service" ? "service" : "main";
    const plate = randomPlate(random);
    const flat = pickAny(flats.filter((f) => f.residentEmail));
    if (!flat) return;
    const read = await camera(gate, "entry", plate);
    if (read.matchResult !== "unknown" || read.visitId) return;

    schedule(scaled(between(20, 60) * 1000), "guard registers", async () => {
      let visit: { id: string; approval: { id: string } | null };
      try {
        visit = (await guard("POST", "/api/visits", {
          flatId: flat.id,
          category,
          visitor: {
            fullName: pick(VISITOR_NAMES),
            phone: `+919${String(Math.floor(100_000_000 + random() * 899_999_999))}`,
          },
          purpose: pick(PURPOSES[category]),
          gateEventId: read.id,
        })) as typeof visit;
      } catch (err) {
        if (err instanceof ApiFailure && err.status === 409) return; // a real guard got there first
        throw err;
      }
      summary.visits++;
      const r = random();
      const answer = r < 0.8 ? "approve" : r < 0.9 ? "deny" : null;
      if (answer && visit.approval && flat.residentEmail) {
        const approvalId = visit.approval.id;
        const email = flat.residentEmail;
        schedule(scaled(between(10, 90) * 1000), "resident answers", async () => {
          const v = (await as(email, "POST", `/api/approvals/${approvalId}/decision`, {
            decision: answer,
          })) as { status: string };
          summary.approvals++;
          if (v.status === "inside")
            schedule(stayMs(category), "visitor leaves", () => leave(gate, plate));
        });
      } else {
        // Nobody answers: once the residents' time is up the guard decides (real seconds).
        schedule((approvalTimeoutSec + 10) * 1000, "guard decides", async () => {
          const decision = random() < 0.85 ? "approve" : "deny";
          const v = (await guard("POST", `/api/visits/${visit.id}/decision`, { decision })) as {
            status: string;
          };
          summary.guardDecisions++;
          if (v.status === "inside")
            schedule(stayMs(category), "visitor leaves", () => leave(gate, plate));
        });
      }
    });
  }

  async function leave(gate: "main" | "service", plate: string) {
    await camera(gate, "exit", plate);
  }

  async function guestPass() {
    const flat = pickAny(flats.filter((f) => f.residentEmail));
    if (!flat?.residentEmail) return;
    const plate = randomPlate(random);
    await as(flat.residentEmail, "POST", "/api/guest-passes", {
      flatId: flat.id,
      guestName: pick(VISITOR_NAMES),
      plate,
      withCode: false,
      validUntil: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      maxUses: 1,
    });
    summary.guestPasses++;
    schedule(scaled(between(2, 10) * 60_000), "guest arrives", async () => {
      const read = await camera("main", "entry", plate);
      if (read.visitId) schedule(stayMs("guest"), "guest leaves", () => leave("main", plate));
    });
  }

  // --- the simulated guard's rounds: clear what has waited too long ---
  async function guardRounds() {
    schedule(scaled(60_000), "guard rounds", guardRounds);
    const old = (iso: string, minutes: number) =>
      Date.now() - new Date(iso).getTime() > scaled(minutes * 60_000);

    const queueItems = (await guard("GET", "/api/gate-events/review-queue?limit=50")) as {
      items: { id: string; capturedAt: string }[];
    };
    for (const e of queueItems.items.filter((i) => old(i.capturedAt, 2))) {
      const plate = truePlates.get(e.id);
      await guard(
        "POST",
        `/api/gate-events/${e.id}/review`,
        plate ? { action: "correct", plate } : { action: "dismiss" },
      ).catch(ignore409);
      truePlates.delete(e.id);
      summary.reviews++;
    }

    const alerts = (await guard("GET", "/api/alerts?acknowledged=false&limit=50")) as {
      items: { id: string; createdAt: string }[];
    };
    for (const a of alerts.items.filter((i) => old(i.createdAt, 3))) {
      await guard("POST", `/api/alerts/${a.id}/acknowledge`);
      summary.alertsAcknowledged++;
    }

    const calls = (await guard("GET", "/api/escalations?status=open&limit=50")) as {
      items: { id: string; createdAt: string }[];
    };
    for (const t of calls.items.filter((i) => old(i.createdAt, 8))) {
      await guard("POST", `/api/escalations/${t.id}/resolve`, {
        outcome: random() < 0.7 ? "reached" : "not_reached",
        notes: "Resident says the visitor is leaving now",
      }).catch(ignore409);
      summary.callsResolved++;
    }

    // Visitors the guard must decide on (their residents never answered), also ones the
    // simulator did not create (e.g. the seed's).
    const pending = (await guard("GET", "/api/visits?status=pending_approval&limit=50")) as {
      items: { id: string; approval: { secondsLeft: number } | null }[];
    };
    for (const v of pending.items.filter((i) => i.approval && i.approval.secondsLeft === 0)) {
      await guard("POST", `/api/visits/${v.id}/decision`, { decision: "approve" }).catch(ignore409);
      summary.guardDecisions++;
    }

    // Long-forgotten visitors (not ours, far past their limit): the guard logs them out.
    const inside = (await guard("GET", "/api/analytics/inside")) as {
      visitors: { visitId: string; expectedExitAt: string | null }[];
    };
    for (const v of inside.visitors.filter(
      (i) => i.expectedExitAt && Date.now() - new Date(i.expectedExitAt).getTime() > 3 * 3_600_000,
    )) {
      await guard("POST", `/api/visits/${v.visitId}/exit`).catch(ignore409);
    }
  }

  function ignore409(err: unknown) {
    if (err instanceof ApiFailure && err.status === 409) return;
    throw err;
  }

  // --- main loop ---
  const endAt = opts.minutes > 0 ? Date.now() + opts.minutes * 60_000 : Infinity;
  let lastReport = Date.now();
  let needBootstrap = true;
  while (Date.now() < endAt && !signal?.aborted) {
    if (needBootstrap) {
      try {
        await bootstrap();
        needBootstrap = false;
      } catch (err) {
        log(
          `not ready yet (${err instanceof Error ? err.message : String(err)}); retrying in 15 s`,
        );
        await sleep(Math.min(15_000, Math.max(0, endAt - Date.now())));
        continue;
      }
    }
    const now = Date.now();
    const due = queue.filter((t) => t.at <= now).sort((a, b) => a.at - b.at);
    queue = queue.filter((t) => t.at > now);
    for (const task of due) {
      try {
        await task.run();
      } catch (err) {
        const status = err instanceof ApiFailure ? err.status : 0;
        if (status === 401) {
          // Keys or accounts are gone: a demo reset. Start over with fresh keys.
          log("credentials stopped working (demo reset?); starting over");
          summary.restarts++;
          needBootstrap = true;
          break;
        }
        summary.errors++;
        log(`${task.label} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (now - lastReport > 60_000) {
      lastReport = now;
      log(
        `reads ${String(summary.reads)} · visits ${String(summary.visits)} · approvals ${String(summary.approvals)} · guard decisions ${String(summary.guardDecisions)} · passes ${String(summary.guestPasses)} · reviews ${String(summary.reviews)}`,
      );
    }
    await sleep(200);
  }
  return summary;
}

// Run only as a script (`tsx src/simulator.ts`), not when a test imports this file.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const controller = new AbortController();
  process.on("SIGTERM", () => {
    controller.abort();
  });
  process.on("SIGINT", () => {
    controller.abort();
  });
  runSimulator(parseArgs(process.argv.slice(2)), controller.signal)
    .then((s) => {
      console.log(`[simulator] stopped: ${JSON.stringify(s)}`);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
