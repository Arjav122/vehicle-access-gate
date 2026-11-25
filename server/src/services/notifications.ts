// Notifications (brief §10.6): queue first, send later.
// - Business steps only INSERT rows into `notifications` (the "outbox"), inside their own
//   transaction, with an idempotency key such as `visit:<id>:overstay:resident:<userId>`.
//   `ON CONFLICT DO NOTHING` means re-running a step never queues the same email twice.
// - A dispatcher (every minute) claims due rows with FOR UPDATE SKIP LOCKED, so two dispatchers
//   never send the same row, and retries failures with backoff 1, 2, 4 … 60 minutes, at most 5
//   attempts, after which the row is `failed` with its last error.
// - Every email has an HTML and a plain-text part. Values are HTML-escaped.
import nodemailer from "nodemailer";
import { config } from "../config.js";
import type { Tx } from "../db.js";
import { withTx } from "../db.js";

export const MAX_ATTEMPTS = 5;

/** Minutes to wait after the nth failed attempt: 1, 2, 4, 8, 16 … capped at 60. */
export function backoffMinutes(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1));
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface Rendered {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const IST = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});
export const formatIst = (d: Date) => `${IST.format(d)} IST`;

/** One layout for every email: a heading, a few lines, and a footer. */
function layout(heading: string, lines: string[]): Rendered {
  const text = [heading, "", ...lines, "", "— Gate desk", config.PUBLIC_BASE_URL].join("\n");
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;max-width:560px">
<h2 style="font-size:18px">${escapeHtml(heading)}</h2>
${lines.map((l) => `<p style="margin:6px 0">${escapeHtml(l)}</p>`).join("\n")}
<p style="color:#666;font-size:12px;margin-top:24px">Gate desk · <a href="${escapeHtml(config.PUBLIC_BASE_URL)}">${escapeHtml(config.PUBLIC_BASE_URL)}</a></p>
</body></html>`;
  return { subject: heading, text, html };
}

export interface VisitFacts {
  flatLabel: string;
  visitorName: string | null;
  plate: string | null;
  category: string;
  expectedExitAt: Date | null;
}

const who = (v: VisitFacts) => v.visitorName ?? "Your visitor";
const plateLine = (v: VisitFacts) => (v.plate ? [`Vehicle: ${v.plate}`] : []);

export const templates = {
  visitApproved: (v: VisitFacts): Rendered =>
    layout(`Your visit to ${v.flatLabel} is approved`, [
      `Hello ${v.visitorName ?? ""}`.trim() + ",",
      `The residents of ${v.flatLabel} approved your ${v.category} visit.`,
      ...plateLine(v),
      ...(v.expectedExitAt ? [`Please leave by ${formatIst(v.expectedExitAt)}.`] : []),
    ]),
  overstayVisitor: (v: VisitFacts): Rendered =>
    layout(`Your visit time at ${v.flatLabel} is over`, [
      `The time allowed for your ${v.category} visit ended at ${v.expectedExitAt ? formatIst(v.expectedExitAt) : "the set time"}.`,
      "Please leave the premises, or ask your host to contact the gate.",
      ...plateLine(v),
    ]),
  overstayResident: (v: VisitFacts): Rendered =>
    layout(`${who(v)} has stayed past the time limit`, [
      `${who(v)} (${v.category}) at ${v.flatLabel} was due to leave by ${v.expectedExitAt ? formatIst(v.expectedExitAt) : "the set time"}.`,
      ...plateLine(v),
      "If they are staying longer on purpose, please tell the gate.",
    ]),
  reminderResident: (v: VisitFacts): Rendered =>
    layout(`Reminder: ${who(v)} is still inside`, [
      `${who(v)} at ${v.flatLabel} is still inside, 30 minutes after the time limit.`,
      ...plateLine(v),
      "The guard will call you if the visitor has not left within the next 30 minutes.",
    ]),
};

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface QueueInput {
  kind: string;
  to: string;
  key: string;
  message: Rendered;
  /** When it may first be sent (default: now). */
  at?: Date;
}

/** Add an email to the outbox, once per idempotency key. Returns true if newly queued. */
export async function queueEmail(tx: Tx, input: QueueInput): Promise<boolean> {
  const inserted = await tx.$executeRaw`
    INSERT INTO notifications (id, channel, kind, recipient, subject, body_text, body_html, status,
                               attempts, next_attempt_at, idempotency_key, created_at)
    VALUES (gen_random_uuid(), 'email', ${input.kind}, ${input.to}, ${input.message.subject},
            ${input.message.text}, ${input.message.html}, 'pending', 0, ${input.at ?? new Date()},
            ${input.key}, now())
    ON CONFLICT (idempotency_key) DO NOTHING`;
  return inserted === 1;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}

/** Real SMTP (Mailpit in development). */
export function smtpMailer(): Mailer {
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    ...(config.SMTP_USER
      ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? "" } }
      : {}),
  });
  return {
    send: async (mail) => {
      await transport.sendMail(mail);
    },
  };
}

export interface DispatchResult {
  sent: number;
  retrying: number;
  failed: number;
}

/**
 * Send what is due, one row per short transaction. SKIP LOCKED lets several dispatchers run
 * side by side without sending a row twice.
 */
export async function dispatchDue(
  mailer: Mailer,
  now = new Date(),
  limit = 50,
): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, retrying: 0, failed: 0 };
  for (let i = 0; i < limit; i++) {
    const outcome = await withTx(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM notifications
        WHERE status = 'pending' AND next_attempt_at <= ${now}
        ORDER BY next_attempt_at, created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      const row = rows[0];
      if (!row) return "empty" as const;
      const n = await tx.notification.findUniqueOrThrow({ where: { id: row.id } });
      try {
        await mailer.send({
          from: config.SMTP_FROM,
          to: n.recipient,
          subject: n.subject ?? "",
          text: n.bodyText,
          html: n.bodyHtml ?? "",
        });
      } catch (err) {
        const attempts = n.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        await tx.notification.update({
          where: { id: n.id },
          data: {
            attempts,
            status: giveUp ? "failed" : "pending",
            lastError: err instanceof Error ? err.message.slice(0, 500) : String(err),
            nextAttemptAt: new Date(now.getTime() + backoffMinutes(attempts) * 60_000),
          },
        });
        return giveUp ? ("failed" as const) : ("retrying" as const);
      }
      await tx.notification.update({
        where: { id: n.id },
        data: { status: "sent", attempts: n.attempts + 1, sentAt: now, lastError: null },
      });
      return "sent" as const;
    });
    if (outcome === "empty") break;
    result[outcome]++;
  }
  return result;
}
