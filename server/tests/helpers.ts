// Shared test helpers: empty the database, create people, get tokens, build the app.
import request from "supertest";
import { prisma } from "../src/db.js";
import type { Role } from "../generated/prisma/enums.js";
import { createApp } from "../src/index.js";
import { hashPassword, issueTokens } from "../src/services/auth.js";

export const PASSWORD = "correct-horse-battery";
let passwordHash: Promise<string> | undefined;

/** Empty every table (except migrations) so each test starts clean. */
export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`,
  );
}

let counter = 0;

/** Create a user with PASSWORD. Residents get a flat unless one is given. */
export async function createUser(
  role: Role,
  opts: { email?: string; flatId?: string; isActive?: boolean } = {},
) {
  passwordHash ??= hashPassword(PASSWORD);
  counter++;
  const user = await prisma.user.create({
    data: {
      email: opts.email ?? `${role}${String(counter)}@example.com`,
      fullName: `Test ${role} ${String(counter)}`,
      role,
      passwordHash: await passwordHash,
      isActive: opts.isActive ?? true,
    },
  });
  if (role === "resident") {
    const flatId =
      opts.flatId ??
      (await prisma.flat.create({ data: { block: "Z", number: String(900 + counter), floor: 9 } }))
        .id;
    await prisma.resident.create({ data: { userId: user.id, flatId, residentType: "owner" } });
  }
  return user;
}

/** An access token for a user, without going through the (rate-limited) login endpoint. */
export async function tokenFor(userId: string): Promise<string> {
  return (await issueTokens(userId)).accessToken;
}

/** A fresh app (fresh rate-limit counters) and an authed request helper. */
export function makeApi() {
  const app = createApp();
  const as = (token?: string) => {
    const auth = (r: request.Test) => (token ? r.set("Authorization", `Bearer ${token}`) : r);
    return {
      get: (url: string) => auth(request(app).get(url)),
      post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
      patch: (url: string, body?: object) => auth(request(app).patch(url)).send(body ?? {}),
      delete: (url: string) => auth(request(app).delete(url)),
    };
  };
  return { app, as };
}

/** Admin + their token, the most common starting point. */
export async function adminApi() {
  const admin = await createUser("admin");
  const api = makeApi();
  return { ...api, admin, asAdmin: api.as(await tokenFor(admin.id)) };
}
