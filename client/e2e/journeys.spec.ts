// The three end-to-end journeys (brief §14), against the real stack: browser → Vite → API →
// Postgres, real-time events over Socket.io, real cameras simulated through the camera API.
//
//   docker compose up -d && docker compose exec server npm run seed -- --reset --no-history
//   cd client && npm run e2e
//
// Journey 3 needs short time limits so it finishes in minutes; start the server with
//   VISIT_LIMIT_CAB_MINUTES=1 OVERSTAY_REMINDER_MINUTES=1 OVERSTAY_ESCALATION_MINUTES=2
// (CI does). With the normal limits it is skipped and says why.
import { expect, test } from "@playwright/test";
import {
  apiAs,
  cameraRead,
  type Cameras,
  freshPlate,
  MAILPIT,
  plateLabel,
  signIn,
  testCameras,
  token,
} from "./helpers";
import { plateGroups } from "../src/lib/plates";

let cameras: Cameras;
let admin = "";
let flatA101 = "";

test.beforeAll(async ({ request }) => {
  admin = await token(request, "admin@example.com");
  cameras = await testCameras(request, admin);
  const flats = await apiAs<{ items: { id: string }[] }>(
    request,
    admin,
    "GET",
    "/api/flats?q=A-101",
  );
  flatA101 = flats.items[0]?.id ?? "";
  expect(flatA101, "flat A-101 exists (seed the database)").not.toBe("");
});

test("1. a resident's car is logged in and out without stopping", async ({ page, request }) => {
  const vehicles = await apiAs<{ items: { plate: string; flatLabel: string }[] }>(
    request,
    admin,
    "GET",
    "/api/vehicles?limit=1&isActive=true",
  );
  const car = vehicles.items[0];
  if (!car) throw new Error("No resident vehicles: seed the database");

  await signIn(page, "guard");
  await expect(page.getByText("Live arrivals")).toBeVisible();

  // The camera reads the plate with a typical OCR look-alike; the server repairs it.
  const entry = await cameraRead(request, cameras.entry, car.plate.replace(/0/g, "O"));
  expect(entry.event.matchResult).toBe("resident");

  // The guard sees it live (no reload): the plate and what happened, in words.
  const arrivals = page.locator("section", { hasText: "Live arrivals" });
  const row = arrivals
    .locator("li")
    .filter({ has: page.getByRole("img", { name: plateLabel(plateGroups(car.plate)) }) })
    .first();
  await expect(row).toContainText(`Resident car of ${car.flatLabel}: entry logged`);

  const exit = await cameraRead(request, cameras.exit, car.plate);
  expect(exit.event.matchResult).toBe("resident");
  await expect(
    arrivals.getByText(`Resident car of ${car.flatLabel}: exit logged`).first(),
  ).toBeVisible();
});

test("2. an unknown visitor is registered by the guard and approved by the resident", async ({
  browser,
  page,
  request,
}) => {
  const plate = freshPlate();
  const name = `E2E Visitor ${String(Date.now() % 100000)}`;

  await signIn(page, "guard");
  await cameraRead(request, cameras.entry, plate);

  // The new car appears with a Register button; the guard registers it for A-101.
  const arrivals = page.locator("section", { hasText: "Live arrivals" });
  const row = arrivals
    .locator("li")
    .filter({ has: page.getByRole("img", { name: plateLabel(plateGroups(plate)) }) })
    .first();
  await expect(row).toContainText("New car: register the visitor");
  await row.getByRole("button", { name: /Register/ }).click();
  const dialog = page.getByRole("dialog", { name: "Register visitor" });
  await dialog.getByLabel("Flat").fill("A-101");
  await dialog.getByRole("option", { name: "A-101" }).click();
  await dialog.getByLabel("Visitor name").fill(name);
  await dialog.getByLabel("Category").selectOption("delivery");
  await dialog.getByRole("button", { name: /Ask A-101/ }).click();
  await expect(page.getByText("Sent to A-101 for approval")).toBeVisible();
  // No second registration possible: the button is gone from that arrival.
  await expect(row.getByRole("button", { name: /Register/ })).toHaveCount(0);

  // The resident, on a phone, approves.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const residentPage = await phone.newPage();
  await signIn(residentPage, "resident");
  const card = residentPage.locator("section").filter({ hasText: name });
  await expect(card.getByText("Answer within")).toBeVisible();
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(residentPage.getByText("Approved. The guard will let them in.")).toBeVisible();
  await phone.close();

  // The guard's console updates live: the visitor is inside.
  const inside = page.locator("section", { hasText: "Visitors inside" });
  await expect(inside.locator("li").filter({ hasText: name })).toContainText("Inside");

  // The exit camera closes the visit.
  await cameraRead(request, cameras.exit, plate);
  await expect(inside.locator("li").filter({ hasText: name })).toHaveCount(0);
});

test("3. an overstaying visitor is followed up: emails, then a call task for the guard", async ({
  page,
  request,
}) => {
  test.setTimeout(6 * 60_000);
  const settings = await apiAs<{ cabMinutes: number }>(request, admin, "GET", "/api/settings");
  test.skip(
    settings.cabMinutes > 1,
    "Start the server with VISIT_LIMIT_CAB_MINUTES=1 OVERSTAY_REMINDER_MINUTES=1 OVERSTAY_ESCALATION_MINUTES=2",
  );

  const plate = freshPlate();
  const name = `E2E Cab ${String(Date.now() % 100000)}`;
  const guard = await token(request, "guard@example.com");
  const resident = await token(request, "resident@example.com");

  // A cab arrives, the guard registers it, the resident approves: the car is inside.
  const read = await cameraRead(request, cameras.entry, plate);
  const visit = await apiAs<{ id: string; approval: { id: string } }>(
    request,
    guard,
    "POST",
    "/api/visits",
    {
      flatId: flatA101,
      category: "cab",
      visitor: { fullName: name, email: "e2e-cab@example.com" },
      gateEventId: read.event.id,
    },
  );
  const approved = await apiAs<{ status: string }>(
    request,
    resident,
    "POST",
    `/api/approvals/${visit.approval.id}/decision`,
    { decision: "approve" },
  );
  expect(approved.status).toBe("inside");

  await signIn(page, "guard");
  const inside = page.locator("section", { hasText: "Visitors inside" });
  const row = inside.locator("li").filter({ hasText: name });
  await expect(row).toContainText("Inside");

  // Past the 1-minute limit the ladder marks it overstayed and emails visitor + resident…
  await expect(row).toContainText("Overstayed", { timeout: 150_000 });
  // …and later the guard gets a "call the resident" task with the number to dial.
  const calls = page.locator("section", { hasText: "Call the resident" });
  const task = calls.locator("li").filter({ hasText: name });
  await expect(task).toBeVisible({ timeout: 180_000 });
  await expect(task.getByRole("link", { name: /Call Priya Sharma/ })).toBeVisible();
  await task.getByRole("button", { name: "Reached" }).click();
  await expect(page.getByText("Call recorded")).toBeVisible();
  await expect(task).toHaveCount(0);

  // The overstay emails really went out (Mailpit catches them in dev and CI).
  await expect
    .poll(
      async () => {
        const res = await request.get(`${MAILPIT}/api/v1/messages?limit=100`);
        const body = (await res.json()) as { messages: { Subject: string }[] };
        return body.messages.map((m) => m.Subject);
      },
      { timeout: 90_000, intervals: [5_000] },
    )
    .toContain(`${name} has stayed past the time limit`);

  // The car leaves: the visit closes.
  await cameraRead(request, cameras.exit, plate);
  await expect(row).toHaveCount(0);
});
