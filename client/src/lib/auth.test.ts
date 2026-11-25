// Token store and refresh: refresh tokens are single-use, so ten requests that hit 401 at the
// same moment must cause ONE refresh call, not ten (a second use would look like token theft
// and the server would sign the user out everywhere).
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "@/test-utils";
import { api, unwrap } from "./api";
import { getTokens, refresh, setTokens } from "./auth";

afterEach(() => {
  setTokens(null);
  vi.unstubAllGlobals();
});

describe("refresh", () => {
  it("is single-flight: parallel callers share one refresh request", async () => {
    setTokens({ accessToken: "old", refreshToken: "r1" });
    const calls = mockApi({
      "POST /api/auth/refresh": {
        accessToken: "new",
        refreshToken: "r2",
        tokenType: "Bearer",
        expiresIn: 900,
      },
    });
    const results = await Promise.all([refresh(), refresh(), refresh()]);
    expect(results).toEqual([true, true, true]);
    expect(calls.filter((c) => c.path === "/api/auth/refresh")).toHaveLength(1);
    expect(getTokens()).toEqual({ accessToken: "new", refreshToken: "r2" });
  });

  it("signs out when the refresh token is refused", async () => {
    setTokens({ accessToken: "old", refreshToken: "revoked" });
    mockApi({
      "POST /api/auth/refresh": () =>
        new Response(JSON.stringify({ detail: "no" }), { status: 401 }),
    });
    expect(await refresh()).toBe(false);
    expect(getTokens()).toBeNull();
  });

  it("mirrors tokens to localStorage and clears them on sign-out", () => {
    setTokens({ accessToken: "a", refreshToken: "b" });
    expect(localStorage.getItem("vehicle-access.tokens")).toContain('"a"');
    setTokens(null);
    expect(localStorage.getItem("vehicle-access.tokens")).toBeNull();
  });
});

describe("api client", () => {
  it("sends the access token, refreshes once on 401 and retries", async () => {
    setTokens({ accessToken: "expired", refreshToken: "r1" });
    const seen: string[] = [];
    mockApi({
      "GET /api/me": (req) => {
        const auth = req.headers.get("Authorization") ?? "";
        seen.push(auth);
        return auth === "Bearer fresh"
          ? { id: "u", email: "a@b.c", fullName: "A", phone: null, role: "guard", flats: [] }
          : new Response(JSON.stringify({ detail: "expired" }), { status: 401 });
      },
      "POST /api/auth/refresh": {
        accessToken: "fresh",
        refreshToken: "r2",
        tokenType: "Bearer",
        expiresIn: 900,
      },
    });
    const me = await unwrap(api.GET("/api/me"));
    expect(me.fullName).toBe("A");
    expect(seen).toEqual(["Bearer expired", "Bearer fresh"]);
  });

  it("throws the server's detail message", async () => {
    mockApi({
      "POST /api/visits/{id}/decision": {},
    });
    await expect(
      unwrap(
        api.POST("/api/visits/{id}/decision", {
          params: { path: { id: "00000000-0000-4000-8000-000000000009" } },
          body: { decision: "approve" },
        }),
      ),
    ).rejects.toMatchObject({ status: 404, message: "Not found" });
  });
});
