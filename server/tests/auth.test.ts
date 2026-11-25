// Sign-in, token rotation and reuse detection, logout, /me (brief §10.7).
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { INVALID_LOGIN } from "../src/services/auth.js";
import { createUser, makeApi, PASSWORD, resetDb, tokenFor } from "./helpers.js";

beforeEach(resetDb);

describe("POST /api/auth/login", () => {
  it("returns a token pair for the right password (email is case-insensitive)", async () => {
    await createUser("guard", { email: "gate@example.com" });
    const res = await makeApi()
      .as()
      .post("/api/auth/login", { email: "Gate@Example.com", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tokenType: "Bearer", expiresIn: 900 });
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");
  });

  it("gives the same answer for a wrong password, an unknown email and a deactivated user", async () => {
    await createUser("guard", { email: "gate@example.com" });
    await createUser("guard", { email: "former@example.com", isActive: false });
    const api = makeApi().as();

    const answers = await Promise.all([
      api.post("/api/auth/login", { email: "gate@example.com", password: "wrong-password" }),
      api.post("/api/auth/login", { email: "nobody@example.com", password: PASSWORD }),
      api.post("/api/auth/login", { email: "former@example.com", password: PASSWORD }),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ detail: INVALID_LOGIN });
    }
  });

  it("rejects unknown fields and bad JSON with 422", async () => {
    const api = makeApi();
    const extra = await api
      .as()
      .post("/api/auth/login", { email: "a@example.com", password: "x", admin: true });
    expect(extra.status).toBe(422);

    const { default: request } = await import("supertest");
    const bad = await request(api.app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{oops");
    expect(bad.status).toBe(422);
    expect(bad.body).toEqual({ detail: "Malformed request body" });
  });

  it("limits attempts per account (10/min) with 429 and Retry-After", async () => {
    const api = makeApi().as();
    for (let i = 0; i < 10; i++) {
      expect(
        (await api.post("/api/auth/login", { email: "target@example.com", password: "guess" }))
          .status,
      ).toBe(401);
    }
    const blocked = await api.post("/api/auth/login", {
      email: "TARGET@example.com",
      password: "guess",
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("60");

    // Another account from the same IP is still allowed (per-IP limit is 20).
    expect(
      (await api.post("/api/auth/login", { email: "other@example.com", password: "guess" })).status,
    ).toBe(401);
  });
});

describe("refresh tokens", () => {
  async function login() {
    await createUser("resident", { email: "res@example.com" });
    const api = makeApi().as();
    const res = await api.post("/api/auth/login", { email: "res@example.com", password: PASSWORD });
    return { api, tokens: res.body as { accessToken: string; refreshToken: string } };
  }

  it("swaps a refresh token for a new pair, once", async () => {
    const { api, tokens } = await login();
    const first = await api.post("/api/auth/refresh", { refreshToken: tokens.refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(tokens.refreshToken);

    const again = await api.post("/api/auth/refresh", { refreshToken: tokens.refreshToken });
    expect(again.status).toBe(401);
  });

  it("reusing a spent refresh token signs the user out everywhere", async () => {
    const { api, tokens } = await login();
    const rotated = await api.post("/api/auth/refresh", { refreshToken: tokens.refreshToken });
    await api.post("/api/auth/refresh", { refreshToken: tokens.refreshToken }); // replay → theft assumed

    const newer = await api.post("/api/auth/refresh", { refreshToken: rotated.body.refreshToken });
    expect(newer.status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  it("logout revokes the refresh token", async () => {
    const { api, tokens } = await login();
    expect((await api.post("/api/auth/logout", { refreshToken: tokens.refreshToken })).status).toBe(
      204,
    );
    expect(
      (await api.post("/api/auth/refresh", { refreshToken: tokens.refreshToken })).status,
    ).toBe(401);
  });

  it("an access token cannot be used as a refresh token, nor the other way round", async () => {
    const { api, tokens } = await login();
    expect((await api.post("/api/auth/refresh", { refreshToken: tokens.accessToken })).status).toBe(
      401,
    );
    expect((await makeApi().as(tokens.refreshToken).get("/api/me")).status).toBe(401);
  });
});

describe("access tokens", () => {
  it("are rejected when signed with another key, expired, or using another algorithm", async () => {
    const user = await createUser("admin");
    const forge = (secret: string, exp: number) =>
      new SignJWT({ type: "access" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(user.id)
        .setJti("x")
        .setIssuer("vehicle-access")
        .setAudience("vehicle-access-api")
        .setExpirationTime(exp)
        .sign(new TextEncoder().encode(secret));
    const now = Math.floor(Date.now() / 1000);

    const wrongKey = await forge("some-other-secret-that-is-long-enough-0000", now + 600);
    const expired = await forge(process.env.JWT_SECRET ?? "", now - 10);
    const none = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(
      JSON.stringify({ sub: user.id, type: "access", jti: "x", exp: now + 600 }),
    ).toString("base64url")}.`;

    for (const token of [wrongKey, expired, none, "garbage"]) {
      expect((await makeApi().as(token).get("/api/me")).status).toBe(401);
    }
  });

  it("stop working the moment a user is deactivated", async () => {
    const user = await createUser("guard");
    const token = await tokenFor(user.id);
    expect((await makeApi().as(token).get("/api/me")).status).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect((await makeApi().as(token).get("/api/me")).status).toBe(401);
  });
});

describe("GET /api/me", () => {
  it("returns residents with their flats", async () => {
    const flat = await prisma.flat.create({ data: { block: "B", number: "402", floor: 4 } });
    const user = await createUser("resident", { flatId: flat.id });
    const res = await makeApi()
      .as(await tokenFor(user.id))
      .get("/api/me");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      role: "resident",
      flats: [{ id: flat.id, label: "B-402", residentType: "owner" }],
    });
    expect(res.body).not.toHaveProperty("passwordHash");
  });
});
