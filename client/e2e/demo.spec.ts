// Frames for the README demo GIF, captured from the running app (never mocked):
//   docker compose up -d && docker compose exec server npm run seed -- --reset
//   cd client && npm run demo:frames
//   ..\anpr\.venv\Scripts\python e2e\frames_to_gif.py      (Pillow; writes docs/assets/demo.gif)
// The story: a resident drives in → a new car arrives → the guard registers the visitor →
// the resident approves on a phone → the guard sees the car inside → the admin overview.
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { cameraRead, freshPlate, plateLabel, signIn, testCameras, token } from "./helpers";
import { plateGroups } from "../src/lib/plates";

const OUT = "test-results/demo-frames";
interface Frame {
  file: string;
  caption: string;
  ms: number;
  phone?: boolean;
}
const frames: Frame[] = [];

// 16:9 like the GIF, so nothing is stretched.
test.use({ viewport: { width: 1280, height: 720 } });

async function frame(page: Page, caption: string, ms = 2200, phone = false) {
  await page.waitForTimeout(500); // let toasts and live updates settle
  const file = `${String(frames.length).padStart(2, "0")}.png`;
  await page.screenshot({ path: `${OUT}/${file}` });
  frames.push({ file, caption, ms, ...(phone ? { phone } : {}) });
}

test("demo frames", async ({ browser, page, request }) => {
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });
  const admin = await token(request, "admin@example.com");
  const cameras = await testCameras(request, admin);
  const vehicles = (await (
    await request.get("/api/vehicles?limit=1&isActive=true", {
      headers: { Authorization: `Bearer ${admin}` },
    })
  ).json()) as { items: { plate: string; flatLabel: string }[] };
  const car = vehicles.items[0];
  if (!car) throw new Error("Seed the database first");

  await page.addInitScript(() => {
    localStorage.setItem("vehicle-access.guard-theme", "dark");
    localStorage.setItem("vehicle-access.theme", "light");
  });
  await signIn(page, "guard");
  await expect(page.getByText("Live arrivals")).toBeVisible();
  await frame(
    page,
    "Guard console: live arrivals, visitors waiting, things that need attention",
    2600,
  );

  await cameraRead(request, cameras.entry, car.plate.replace(/0/g, "O"));
  await expect(
    page.getByText(`Resident car of ${car.flatLabel}: entry logged`).first(),
  ).toBeVisible();
  await frame(
    page,
    `The camera reads a resident's plate (O/0 mix-up repaired): entry logged, no stopping`,
  );

  const plate = freshPlate();
  await cameraRead(request, cameras.entry, plate);
  const row = page
    .locator("section", { hasText: "Live arrivals" })
    .locator("li")
    .filter({ has: page.getByRole("img", { name: plateLabel(plateGroups(plate)) }) })
    .first();
  await expect(row).toContainText("New car: register the visitor");
  await frame(page, "An unknown car arrives: the guard is told to register the visitor");

  await row.getByRole("button", { name: /Register/ }).click();
  const dialog = page.getByRole("dialog", { name: "Register visitor" });
  await dialog.getByLabel("Flat").fill("A-101");
  await dialog.getByRole("option", { name: "A-101" }).click();
  await dialog.getByLabel("Visitor name").fill("Ravi Kumar");
  await dialog.getByLabel("Category").selectOption("delivery");
  await dialog.getByLabel("Purpose (optional)").fill("Amazon parcel");
  await frame(page, "Two taps: flat, name, purpose. The form is already linked to the waiting car");
  await dialog.getByRole("button", { name: /Ask A-101/ }).click();
  await expect(page.getByText("Sent to A-101 for approval")).toBeVisible();
  await frame(page, "The residents of A-101 have 3 minutes to answer; then the guard decides");

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  const resident = await phone.newPage();
  await resident.addInitScript(() => {
    localStorage.setItem("vehicle-access.theme", "light");
  });
  await signIn(resident, "resident");
  const card = resident.locator("section").filter({ hasText: "Ravi Kumar" }).first();
  await expect(card.getByText("Answer within")).toBeVisible();
  await frame(resident, "On the resident's phone, in real time: Approve or Deny", 2600, true);
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(resident.getByText("Approved. The guard will let them in.")).toBeVisible();
  await frame(resident, "One tap", 1600, true);
  await phone.close();

  const inside = page.locator("section", { hasText: "Visitors inside" });
  await expect(
    inside
      .locator("li")
      .filter({ has: page.getByRole("img", { name: plateLabel(plateGroups(plate)) }) }),
  ).toContainText("Inside");
  await frame(
    page,
    "The guard console updates live: the car is inside, its time limit running",
    2600,
  );

  const adminPage = await (
    await browser.newContext({ viewport: { width: 1280, height: 720 } })
  ).newPage();
  await adminPage.addInitScript(() => {
    localStorage.setItem("vehicle-access.theme", "light");
  });
  await signIn(adminPage, "admin");
  await expect(adminPage.getByText("Busiest hours")).toBeVisible();
  await adminPage.waitForTimeout(800);
  await frame(
    adminPage,
    "The society office: traffic, busiest hours, overstay rate, frequent visitors",
    3000,
  );

  writeFileSync(`${OUT}/frames.json`, JSON.stringify(frames, null, 2));
});
