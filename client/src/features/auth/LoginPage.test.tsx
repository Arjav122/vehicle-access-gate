// Sign-in: demo buttons appear only in demo mode; signing in lands each role in its own area,
// and the signed-in user is written into the cache (not refetched after a cache wipe).
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTokens, setTokens } from "@/lib/auth";
import { ME, mockApi, renderAt } from "@/test-utils";
import LoginPage from "./LoginPage";

afterEach(() => {
  setTokens(null);
  vi.unstubAllGlobals();
});

const DEMO = {
  society: "Green Valley Residency, Greater Noida",
  password: "demo-pass",
  accounts: [
    { role: "guard", email: "guard@example.com", label: "Ramesh Kumar" },
    { role: "resident", email: "resident@example.com", label: "Priya Sharma" },
    { role: "admin", email: "admin@example.com", label: "Rakesh Khanna" },
  ],
};
const TOKENS = { accessToken: "a", refreshToken: "r", tokenType: "Bearer", expiresIn: 900 };

describe("LoginPage", () => {
  it("hides the demo buttons when demo mode is off", async () => {
    mockApi({});
    renderAt(<LoginPage />, { path: "/login" });
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/Continue as/)).not.toBeInTheDocument();
    });
  });

  it("signs in with one click as the demo resident and opens the resident app", async () => {
    const calls = mockApi({
      "GET /api/demo": DEMO,
      "POST /api/auth/login": TOKENS,
      "GET /api/me": ME.resident,
    });
    const { router, client } = renderAt(<LoginPage />, { path: "/login" });
    await userEvent.click(await screen.findByRole("button", { name: /Continue as resident/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/resident");
    });
    expect(calls.find((c) => c.path === "/api/auth/login")?.body).toEqual({
      email: "resident@example.com",
      password: "demo-pass",
    });
    expect(getTokens()?.accessToken).toBe("a");
    expect(client.getQueryData(["me"])).toMatchObject({ role: "resident" });
  });

  it("shows the server's message for wrong credentials", async () => {
    mockApi({
      "POST /api/auth/login": () =>
        new Response(JSON.stringify({ detail: "Incorrect email or password" }), { status: 401 }),
    });
    renderAt(<LoginPage />, { path: "/login" });
    await userEvent.type(await screen.findByLabelText("Email"), "guard@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password");
    expect(getTokens()).toBeNull();
  });

  it("only follows ?next= inside the user's own area (no open redirect)", async () => {
    mockApi({ "POST /api/auth/login": TOKENS, "GET /api/me": ME.guard });
    const { router } = renderAt(<LoginPage />, {
      path: "/login",
      at: "/login?next=//evil.example/phish",
    });
    await userEvent.type(await screen.findByLabelText("Email"), "guard@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/guard");
    });
  });
});
