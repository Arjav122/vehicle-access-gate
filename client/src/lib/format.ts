// Formatting for screens: IST dates and times, durations, relative times, labels.
// The society runs on Indian time, whatever the browser's time zone is.

import type { Schemas } from "./api";

const TZ = "Asia/Kolkata";

const timeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const dateFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
});
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const toDate = (d: string | Date) => (typeof d === "string" ? new Date(d) : d);

/** "4:05 pm" */
export const formatTime = (d: string | Date) => timeFmt.format(toDate(d));
/** "26 Nov" */
export const formatDate = (d: string | Date) => dateFmt.format(toDate(d));
/** "26 Nov, 4:05 pm" */
export const formatDateTime = (d: string | Date) => dateTimeFmt.format(toDate(d));

/** "45 min", "2 h 10 min" */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${String(m)} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${String(h)} h ${String(rest)} min` : `${String(h)} h`;
}

/** "just now", "5 min ago", "2 h ago", "3 days ago" (or "in 5 min" for the future). */
export function formatRelative(d: string | Date, now = new Date()): string {
  const diff = Math.round((now.getTime() - toDate(d).getTime()) / 60_000);
  const abs = Math.abs(diff);
  const text =
    abs < 1
      ? null
      : abs < 60
        ? `${String(abs)} min`
        : abs < 48 * 60
          ? `${String(Math.round(abs / 60))} h`
          : `${String(Math.round(abs / 1440))} days`;
  if (!text) return "just now";
  return diff >= 0 ? `${text} ago` : `in ${text}`;
}

/** "2:59" for a countdown in seconds. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
}

/** "pending_approval" → "Pending approval" */
export function humanize(value: string): string {
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const CATEGORY_LABEL: Record<string, string> = {
  guest: "Guest",
  delivery: "Delivery",
  cab: "Cab",
  service: "Service",
};

/** "2026-11-20" (a date input, IST) → ISO instant at the start (or end) of that IST day. */
export function istDayBound(day: string, end = false): string {
  return new Date(`${day}T${end ? "23:59:59.999" : "00:00:00"}+05:30`).toISOString();
}

/** What the guard should understand at a glance, in a short sentence. */
export function arrivalSentence(e: Schemas["GateEvent"]): string {
  const lane = e.direction === "entry" ? "entry" : "exit";
  switch (e.matchResult) {
    case "resident":
      return `Resident car${e.vehicle ? ` of ${e.vehicle.flatLabel}` : ""}: ${lane} logged`;
    case "visitor":
      return e.direction === "entry" ? "Expected visitor: let in" : "Visitor left";
    case "guest_pass":
      return "Guest pass: let in";
    case "watchlist":
      return "Watchlist plate: stop the car and check";
    case "low_confidence":
      return "Unclear read: check the plate";
    case "ambiguous":
      return "Two plates match closely: check the plate";
    case "unknown":
      if (e.direction === "exit") return "Unknown car leaving";
      return e.visitId ? "Registered visitor" : "New car: register the visitor";
  }
}

/** "98765 43210" → "+919876543210"; anything else is sent as typed (the server validates). */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  return digits;
}

/** "+919876543210" → "+91 98765 43210" (full numbers appear only where a guard must dial). */
export function formatPhone(phone: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return m ? `+91 ${m[1] ?? ""} ${m[2] ?? ""}` : phone;
}

/** End of the validity window chosen in the form (midnight = IST midnight). */
export function passValidUntil(choice: "today" | "24h" | "3d" | "7d", now = new Date()): Date {
  if (choice === "today") {
    const istDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
    return new Date(Date.parse(`${istDay}T23:59:59+05:30`));
  }
  const hours = choice === "24h" ? 24 : choice === "3d" ? 72 : 168;
  return new Date(now.getTime() + hours * 3_600_000);
}
