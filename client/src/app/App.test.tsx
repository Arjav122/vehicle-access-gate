// Route guards: signed-out users are sent to /login (remembering where they were going);
// a signed-in user in the wrong area is sent to their own area.
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setTokens } from "@/lib/auth";
import { ME, mockApi, renderAt } from "@/test-utils";
import { RequireRole } from "./layouts";

afterEach(() => {
  setTokens(null);
  vi.unstubAllGlobals();
});

const Secret = () => (
  <RequireRole roles={["admin"]}>
    <p>Admin only</p>
  </RequireRole>
);

describe("RequireRole", () => {
  it("sends a signed-out visitor to /login?next=…", async () => {
    const { router } = renderAt(<Secret />, { path: "/admin/visits" });
    await screen.findByText(/Page:/);
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toBe("?next=%2Fadmin%2Fvisits");
  });

  it("sends a guard who opens an admin page to the guard console", async () => {
    setTokens({ accessToken: "a", refreshToken: "r" });
    mockApi({ "GET /api/me": ME.guard });
    const { router } = renderAt(<Secret />, { path: "/admin" });
    await screen.findByText(/Page:/);
    expect(router.state.location.pathname).toBe("/guard");
  });

  it("shows the page to the right role", async () => {
    setTokens({ accessToken: "a", refreshToken: "r" });
    mockApi({ "GET /api/me": { ...ME.guard, role: "admin" } });
    renderAt(<Secret />, { path: "/admin" });
    expect(await screen.findByText("Admin only")).toBeInTheDocument();
  });
});
