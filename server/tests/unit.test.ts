// Pure-function tests: configuration rules and audit diffs.
import { describe, expect, it } from "vitest";
import { DEFAULT_JWT_SECRET, loadConfig } from "../src/config.js";
import { diff } from "../src/services/audit.js";

const base = { DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db" };

describe("loadConfig", () => {
  it("uses documented defaults, and treats empty strings as unset", () => {
    const c = loadConfig({ ...base, PORT: "", ACCESS_TOKEN_MINUTES: "" });
    expect(c.PORT).toBe(4000);
    expect(c.ACCESS_TOKEN_MINUTES).toBe(15);
    expect(c.PLATE_CONFIDENCE_THRESHOLD).toBe(0.8);
    expect(c.RUN_JOBS).toBe(true);
    expect(c.CORS_ORIGINS).toEqual([]);
  });

  it("splits CORS_ORIGINS", () => {
    expect(
      loadConfig({ ...base, CORS_ORIGINS: "http://a.test, http://b.test" }).CORS_ORIGINS,
    ).toEqual(["http://a.test", "http://b.test"]);
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("refuses to start in production with the default or a short JWT secret", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/JWT_SECRET/);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: "production", JWT_SECRET: DEFAULT_JWT_SECRET }),
    ).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, NODE_ENV: "production", JWT_SECRET: "short" })).toThrow(
      /JWT_SECRET/,
    );
    expect(
      loadConfig({ ...base, NODE_ENV: "production", JWT_SECRET: "x".repeat(32) }).NODE_ENV,
    ).toBe("production");
  });

  it("allows the default secret outside production", () => {
    expect(loadConfig(base).JWT_SECRET).toBe(DEFAULT_JWT_SECRET);
  });
});

describe("audit diff", () => {
  it("lists only changed fields as [before, after]", () => {
    expect(diff({ colour: "White", make: "Swift" }, { colour: "Grey", make: "Swift" })).toEqual({
      colour: ["White", "Grey"],
    });
  });

  it("records every field on create and delete", () => {
    expect(diff(null, { name: "Main gate" })).toEqual({ name: [null, "Main gate"] });
    expect(diff({ name: "Main gate" }, null)).toEqual({ name: ["Main gate", null] });
  });

  it("never writes secrets, only notes that a password changed", () => {
    expect(diff({ passwordHash: "a" }, { passwordHash: "b" })).toEqual({
      password: ["(hidden)", "(changed)"],
    });
    expect(diff(null, { passwordHash: "a", apiKeyHash: "k" })).toEqual({});
    expect(JSON.stringify(diff({ apiKeyHash: "old" }, { apiKeyHash: "new" }))).not.toContain("new");
  });

  it("ignores timestamps and serialises dates", () => {
    const d = new Date("2026-11-25T10:00:00.000Z");
    expect(diff({ updatedAt: d, seenAt: null }, { updatedAt: new Date(), seenAt: d })).toEqual({
      seenAt: [null, "2026-11-25T10:00:00.000Z"],
    });
  });
});
