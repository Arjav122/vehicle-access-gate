// Screenshots of every main screen for docs/assets (README and docs). Needs the dev stack with
// demo mode and fresh seed data:
//   docker compose up -d && docker compose exec server npm run seed -- --reset
//   cd client && npm run screenshots
// Signs in for real through the login page (writing localStorage would not sign in: the token
// store keeps an in-memory copy, brief §17).
import { type Page, test } from "@playwright/test";

const OUT = "../docs/assets";
const PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password-change-me";
const PHONE = { width: 390, height: 844 };

async function signIn(page: Page, role: "guard" | "resident" | "admin", theme: "light" | "dark") {
  await page.addInitScript((t) => {
    localStorage.setItem("vehicle-access.theme", t);
    localStorage.setItem("vehicle-access.guard-theme", t);
  }, theme);
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(`Continue as ${role}`) }).click();
  await page.waitForURL(`**/${role}`);
}

async function shot(page: Page, name: string, ready: string) {
  await page.getByText(ready).first().waitFor();
  await page.waitForTimeout(600); // charts animate in
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

test.beforeAll(async ({ request }) => {
  // A visitor waiting for the demo resident (A-101), so the approval screen has something on it.
  const login = await request.post("/api/auth/login", {
    data: { email: "guard@example.com", password: PASSWORD },
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };
  const flats = (await (await request.get("/api/flats?q=A-101", { headers })).json()) as {
    items: { id: string }[];
  };
  await request.post("/api/visits", {
    headers,
    data: {
      flatId: flats.items[0]?.id,
      category: "delivery",
      visitor: { fullName: "Ravi Kumar" },
      purpose: "Amazon parcel",
      plate: "UP16CT4821",
    },
  });
});

test("landing and login", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("vehicle-access.theme", "light");
  });
  await page.goto("/");
  await shot(page, "landing", "Try demo as Guard");
  await page.goto("/login");
  await shot(page, "login", "Continue as guard");
});

test("guard console", async ({ page }) => {
  await signIn(page, "guard", "dark");
  await shot(page, "guard-console", "Live arrivals");
  await page
    .getByRole("button", { name: /Register/ })
    .nth(1)
    .click();
  await shot(page, "guard-register-visitor", "Car waiting at the gate");
});

test("guard console on a phone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, "guard", "dark");
  await shot(page, "guard-console-phone", "Live arrivals");
});

test("resident app", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, "resident", "light");
  await shot(page, "resident-approvals", "Answer within");
  await page.getByRole("link", { name: "Guest passes" }).click();
  await shot(page, "resident-guest-passes", "Your passes");
  await page.getByRole("link", { name: "History" }).click();
  await shot(page, "resident-history", "Visit history");
});

test("admin dashboard", async ({ page }) => {
  await signIn(page, "admin", "light");
  await shot(page, "admin-overview", "Busiest hours");
  await page.getByRole("link", { name: "Visits" }).click();
  await shot(page, "admin-visits", "When");
  await page.getByRole("link", { name: "Gate events" }).click();
  await shot(page, "admin-gate-events", "What happened");
  await page.getByRole("link", { name: "Vehicles" }).click();
  await shot(page, "admin-vehicles", "Add vehicle");
});

test("admin dashboard, dark", async ({ page }) => {
  await signIn(page, "admin", "dark");
  await shot(page, "admin-overview-dark", "Busiest hours");
});
