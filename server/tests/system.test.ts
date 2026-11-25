// Health, readiness, request ids, headers, errors, docs.
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/index.js";

const app = createApp();

describe("probes", () => {
  it("GET /api/health is alive", async () => {
    expect((await request(app).get("/api/health")).body).toEqual({ status: "ok" });
  });

  it("GET /api/ready checks the database", async () => {
    const res = await request(app).get("/api/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("request ids", () => {
  it("keeps a sane incoming X-Request-ID", async () => {
    const res = await request(app).get("/api/health").set("X-Request-ID", "abc-123_DEF.4");
    expect(res.headers["x-request-id"]).toBe("abc-123_DEF.4");
  });

  it("replaces an unsafe one with a fresh UUID", async () => {
    const res = await request(app)
      .get("/api/health")
      .set("X-Request-ID", "bad id <script>alert(1)</script>");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("hardening", () => {
  it("sends security headers and hides Express", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("allows only listed browser origins", async () => {
    const ok = await request(app).get("/api/health").set("Origin", "http://127.0.0.1:5173");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
    const other = await request(app).get("/api/health").set("Origin", "https://evil.example");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects bodies over the size limit with 413", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ email: "a@example.com", password: "x".repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ detail: "Request body is too large" });
  });

  it("answers unknown paths with a JSON 404", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ detail: "Not found" });
  });
});

describe("API docs", () => {
  it("serves an OpenAPI 3.1 document with security schemes", async () => {
    const res = await request(app).get("/api/openapi.json");
    expect(res.body.openapi).toBe("3.1.0");
    expect(Object.keys(res.body.paths)).toContain("/api/vehicles/{id}");
    expect(Object.keys(res.body.components.securitySchemes)).toEqual(["bearerAuth", "deviceKey"]);
  });

  it("serves Swagger UI at /api/docs", async () => {
    const res = await request(app).get("/api/docs/").redirects(1);
    expect(res.status).toBe(200);
    expect(res.text).toContain("swagger-ui");
  });
});
