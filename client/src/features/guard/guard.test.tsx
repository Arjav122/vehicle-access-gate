// Guard console pieces: the countdown hands the decision to the guard when it runs out, and the
// register form links the waiting car's read and refreshes arrivals (no double registration).
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setTokens } from "@/lib/auth";
import { mockApi, renderAt } from "@/test-utils";
import { RegisterVisitorDialog } from "./RegisterVisitorDialog";
import { Waiting } from "./Waiting";

afterEach(() => {
  setTokens(null);
  vi.unstubAllGlobals();
});

const FLAT = {
  id: "00000000-0000-4000-8000-0000000000f1",
  block: "A",
  number: "101",
  floor: 1,
  label: "A-101",
  createdAt: "",
  updatedAt: "",
};
const EVENT_ID = "00000000-0000-4000-8000-0000000000e1";

function visit(secondsLeft: number) {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    flatId: FLAT.id,
    flatLabel: "A-101",
    status: "pending_approval",
    category: "guest",
    purpose: "Birthday dinner",
    plate: "UP16UT3067",
    visitor: { fullName: "Rohit Malhotra", phone: null, email: null },
    guestPassId: null,
    approval: {
      id: "00000000-0000-4000-8000-0000000000b1",
      status: secondsLeft > 0 ? "pending" : "timed_out",
      expiresAt: new Date(Date.now() + secondsLeft * 1000).toISOString(),
      secondsLeft: Math.max(0, secondsLeft),
      channel: null,
    },
    enteredAt: null,
    expectedExitAt: null,
    exitedAt: null,
    durationMinutes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const page = (items: unknown[]) => ({ items, total: items.length, limit: 50, offset: 0 });
const INSIDE = { visitors: [], residentVehicles: 0, total: 0 };

describe("Waiting column", () => {
  it("shows the residents' countdown while they can still answer", async () => {
    mockApi({
      "GET /api/visits": (req) =>
        new URL(req.url).searchParams.get("status") === "pending_approval"
          ? page([visit(120)])
          : page([]),
      "GET /api/analytics/inside": INSIDE,
    });
    renderAt(<Waiting />);
    expect(await screen.findByText(/Asking the residents/)).toBeInTheDocument();
    expect(screen.getByText(/^[12]:\d\d$/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Let in/ })).not.toBeInTheDocument();
  });

  it("lets the guard decide once the time is up", async () => {
    const calls = mockApi({
      "GET /api/visits": (req) =>
        new URL(req.url).searchParams.get("status") === "pending_approval"
          ? page([visit(-5)])
          : page([]),
      "GET /api/analytics/inside": INSIDE,
      [`POST /api/visits/00000000-0000-4000-8000-0000000000a1/decision`]: {
        ...visit(-5),
        status: "inside",
      },
    });
    renderAt(<Waiting />);
    expect(await screen.findByText(/You decide now/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Let in/ }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/decision"))).toBe(true);
    });
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ decision: "approve" });
  });
});

describe("RegisterVisitorDialog", () => {
  it("registers against the waiting car's read and refreshes arrivals", async () => {
    const calls = mockApi({
      "GET /api/flats": page([FLAT]),
      "POST /api/visits": visit(180),
    });
    const onClose = vi.fn();
    const { client } = renderAt(
      <RegisterVisitorDialog
        target={{ plate: "UP16UT3067", gateEventId: EVENT_ID }}
        onClose={onClose}
      />,
    );
    const invalidate = vi.spyOn(client, "invalidateQueries");
    expect(screen.getByText("Car waiting at the gate")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Flat"), "101");
    await userEvent.click(await screen.findByRole("option", { name: "A-101" }));
    await userEvent.type(screen.getByLabelText("Visitor name"), "Rohit Malhotra");
    await userEvent.type(screen.getByLabelText("Mobile (optional)"), "98765 43210");
    await userEvent.click(screen.getByRole("button", { name: /Ask A-101/ }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      flatId: FLAT.id,
      category: "guest",
      visitor: { fullName: "Rohit Malhotra", phone: "+919876543210" },
      gateEventId: EVENT_ID,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["gate-events"] });
  });

  it("will not send without a flat and a name", async () => {
    const calls = mockApi({ "GET /api/flats": page([FLAT]) });
    renderAt(<RegisterVisitorDialog target={{}} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Ask the flat/ }));
    expect(await screen.findByText("Pick the flat being visited")).toBeInTheDocument();
    expect(screen.getByText("Enter the visitor's name")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});
