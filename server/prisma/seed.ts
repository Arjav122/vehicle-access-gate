// Seed a made-up society: "Green Valley Residency, Greater Noida".
//   npm run seed            → fills an empty database
//   npm run seed -- --reset → wipes all data first
// Same output every run (fixed random seed). Demo logins use DEMO_PASSWORD:
//   admin@example.com, guard@example.com, resident@example.com
// Camera device keys are printed once; only their hashes are stored.
// Safety: refuses to touch a database that is not on this machine / in docker compose
// unless --allow-remote is passed.
//
// Phase 1 seeds people, flats, vehicles, gates, devices and the watchlist. Visit history
// (14 days + "right now") is added in later phases, written through the same services.
import { hashPassword } from "../src/services/auth.js";
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { newDeviceKey } from "../src/routes/devices.js";
import { normalizePlate } from "../src/services/plates.js";

const args = new Set(process.argv.slice(2));
const RESET = args.has("--reset");
const ALLOW_REMOTE = args.has("--allow-remote");
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "postgres", "::1"]);

// ---------- Deterministic random numbers (mulberry32) ----------
let state = 20_261_125;
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

// ---------- Main ----------
async function main() {
  const host = new URL(config.DATABASE_URL).hostname;
  if (!LOCAL_HOSTS.has(host) && !ALLOW_REMOTE) {
    throw new Error(
      `Refusing to seed ${host}: not a local database. Pass --allow-remote if you really mean it.`,
    );
  }
  if (!config.DEMO_PASSWORD)
    throw new Error("Set DEMO_PASSWORD (see .env.example) before seeding.");

  if (RESET) {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    const list = tables.map((t) => `"${t.tablename}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    console.log(`Reset: emptied ${String(tables.length)} tables.`);
  } else if ((await prisma.user.count()) > 0) {
    throw new Error("The database already has data. Run `npm run seed -- --reset` to start over.");
  }

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
  for (const gateName of ["Main gate", "Service gate"]) {
    const gate = await prisma.gate.create({ data: { name: gateName } });
    for (const direction of ["entry", "exit"] as const) {
      const { key, hash, prefix } = newDeviceKey();
      const name = `${gateName} ${direction} camera`;
      await prisma.device.create({
        data: { gateId: gate.id, name, direction, apiKeyHash: hash, apiKeyPrefix: prefix },
      });
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

  console.log(`
Seeded "Green Valley Residency, Greater Noida":
  ${String(flats.length)} flats, ${String(residents)} residents, ${String(vehicles)} vehicles, 3 guards, 1 admin,
  2 gates with 4 camera devices, ${String(watch.length)} watchlist plates.

Demo logins (password = DEMO_PASSWORD):
  admin@example.com · guard@example.com · resident@example.com (A-101)

Camera device keys (shown only now; store them on the cameras):
${keys.join("\n")}
`);
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
