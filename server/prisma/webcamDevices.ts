// Set up the laptop webcam as two camera devices (entry + exit lanes) and write their keys to
// anpr/.env, keeping every other line there (brief §11.6).
//   npm run webcam:devices
// Creates (or reuses) gate "Laptop webcam" with devices "Laptop webcam entry" / "… exit", rotates
// both keys (old keys stop working) and stores only their hashes. Like the seed, it refuses a
// database that is not local unless --allow-remote is passed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { prisma } from "../src/db.js";
import { newDeviceKey } from "../src/routes/devices.js";

const GATE = "Laptop webcam";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "postgres", "::1"]);
const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../anpr/.env");

/** Replace or add KEY=value lines, leaving every other line untouched. */
export function upsertEnv(text: string, values: Record<string, string>): string {
  const lines = text.length ? text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n") : [];
  for (const [key, value] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const host = new URL(config.DATABASE_URL).hostname;
  if (!LOCAL_HOSTS.has(host) && !process.argv.includes("--allow-remote")) {
    throw new Error(
      `Refusing to change devices on ${host}: not a local database. Pass --allow-remote if you mean it.`,
    );
  }

  const gate =
    (await prisma.gate.findUnique({ where: { name: GATE } })) ??
    (await prisma.gate.create({ data: { name: GATE } }));
  if (!gate.isActive)
    await prisma.gate.update({ where: { id: gate.id }, data: { isActive: true } });

  const keys: Record<string, string> = {};
  for (const direction of ["entry", "exit"] as const) {
    const name = `${GATE} ${direction}`;
    const { key, hash, prefix } = newDeviceKey();
    await prisma.device.upsert({
      where: { gateId_name: { gateId: gate.id, name } },
      create: { gateId: gate.id, name, direction, apiKeyHash: hash, apiKeyPrefix: prefix },
      update: { direction, apiKeyHash: hash, apiKeyPrefix: prefix, isActive: true },
    });
    keys[direction] = key;
  }

  const before = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const apiUrl = `http://127.0.0.1:${String(config.PORT)}`;
  writeFileSync(
    ENV_FILE,
    upsertEnv(before, {
      ANPR_API_URL: apiUrl,
      ANPR_DEVICE_KEY: keys.entry ?? "",
      ANPR_EXIT_DEVICE_KEY: keys.exit ?? "",
    }),
  );
  console.log(
    `Gate "${GATE}": entry + exit devices ready; keys rotated and written to ${ENV_FILE}`,
  );
  console.log(`The worker will send reads to ${apiUrl}.`);
}

// Run only when executed directly (tests import upsertEnv).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
