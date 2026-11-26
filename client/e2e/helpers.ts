// Shared helpers for the end-to-end journeys: API calls (as a person or as a camera), real
// sign-in through the login page, and a fresh pair of test cameras per run.
import { type APIRequestContext, expect, type Page } from "@playwright/test";

export const PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password-change-me";
export const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";

export async function token(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(res.status(), `sign in as ${email}`).toBe(200);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

export async function apiAs<T>(
  request: APIRequestContext,
  bearer: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await request.fetch(path, {
    method,
    headers: { Authorization: `Bearer ${bearer}` },
    ...(data === undefined ? {} : { data }),
  });
  expect(res.ok(), `${method} ${path} → ${String(res.status())} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

export interface Cameras {
  entry: string;
  exit: string;
}

/** Two fresh cameras on the Main gate for this run (their keys are only known here). */
export async function testCameras(request: APIRequestContext, admin: string): Promise<Cameras> {
  const gates = await apiAs<{ items: { id: string; name: string }[] }>(
    request,
    admin,
    "GET",
    "/api/gates?limit=100",
  );
  const gate = gates.items.find((g) => g.name === "Main gate") ?? gates.items[0];
  if (!gate) throw new Error("No gate: seed the database first");
  const make = async (direction: "entry" | "exit") =>
    (
      await apiAs<{ apiKey: string }>(request, admin, "POST", "/api/devices", {
        gateId: gate.id,
        name: `E2E ${direction} camera ${String(Date.now())}`,
        direction,
      })
    ).apiKey;
  return { entry: await make("entry"), exit: await make("exit") };
}

export interface ReadResult {
  status: string;
  event: { id: string; matchResult: string; visitId: string | null };
}

/** A camera read, exactly as the ANPR worker sends it. */
export async function cameraRead(
  request: APIRequestContext,
  key: string,
  plate: string,
  confidence = 0.95,
): Promise<ReadResult> {
  const res = await request.post("/api/gate-events", {
    headers: { "X-Device-Key": key },
    multipart: {
      plate_text: plate,
      confidence: String(confidence),
      captured_at: new Date().toISOString(),
    },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()) as ReadResult;
}

/** Sign in through the login page with the demo button for `role`. */
export async function signIn(page: Page, role: "guard" | "resident" | "admin") {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(`Continue as ${role}`) }).click();
  await page.waitForURL(`**/${role}`);
}

/** A plate nobody in the seed has: UP32 + 2 letters + 4 digits, unique per call. */
export function freshPlate(): string {
  const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
  const n = Date.now() + Math.floor(Math.random() * 1000);
  const l1 = letters[n % letters.length] ?? "A";
  const l2 = letters[Math.floor(n / 23) % letters.length] ?? "B";
  return `UP32${l1}${l2}${String(1000 + (n % 9000))}`;
}

/** The accessible name PlateChip gives a plate ("Number plate U P 3 2, A B, 1 2 3 4"). */
export function plateLabel(groups: string[]): string {
  return `Number plate ${groups.map((g) => g.split("").join(" ")).join(", ")}`;
}
