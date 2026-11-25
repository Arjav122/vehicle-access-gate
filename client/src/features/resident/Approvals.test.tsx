// Resident approvals: big Approve / Deny with a countdown; once time is up the buttons go
// away (the guard decides); an empty state when nobody is waiting.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderAt } from "@/test-utils";
import Approvals from "./Approvals";

afterEach(() => {
  vi.unstubAllGlobals();
});

const APPROVAL_ID = "00000000-0000-4000-8000-0000000000b1";
const pending = (secondsLeft: number) => ({
  id: "00000000-0000-4000-8000-0000000000a1",
  flatId: "f",
  flatLabel: "A-101",
  status: "pending_approval",
  category: "delivery",
  purpose: "Amazon parcel",
  plate: "UP16UT3067",
  visitor: { fullName: "Ravi Kumar", phone: null, email: null },
  guestPassId: null,
  approval: {
    id: APPROVAL_ID,
    status: "pending",
    expiresAt: new Date(Date.now() + secondsLeft * 1000).toISOString(),
    secondsLeft,
    channel: null,
  },
  enteredAt: null,
  expectedExitAt: null,
  exitedAt: null,
  durationMinutes: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
const page = (items: unknown[]) => ({ items, total: items.length, limit: 20, offset: 0 });

function routes(items: unknown[]) {
  return {
    "GET /api/approvals": (req: Request) =>
      new URL(req.url).searchParams.get("status") === "pending" ? page(items) : page([]),
    [`POST /api/approvals/${APPROVAL_ID}/decision`]: { ...pending(100), status: "approved" },
  };
}

describe("Resident approvals", () => {
  it("says so when nobody is waiting", async () => {
    mockApi(routes([]));
    renderAt(<Approvals />);
    expect(await screen.findByText("Nobody is waiting at the gate")).toBeInTheDocument();
  });

  it("approves with one tap", async () => {
    const calls = mockApi(routes([pending(150)]));
    renderAt(<Approvals />);
    expect(await screen.findByText("Ravi Kumar")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Time left to answer" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({ decision: "approve" });
    });
  });

  it("removes the buttons when time is up", async () => {
    mockApi(routes([pending(-1)]));
    renderAt(<Approvals />);
    expect(await screen.findByText(/The guard at the gate is deciding now/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});
