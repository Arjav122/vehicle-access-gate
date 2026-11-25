// Guest passes (brief §10.5): a resident lets a guest in ahead of time, by plate and/or an
// 8-character code. The code is shown ONCE and stored only as an HMAC; uses are counted with a
// conditional UPDATE, so a pass can never be used more times than allowed, even under races.
import { createHmac, randomInt } from "node:crypto";
import { config } from "../config.js";
import type { Tx } from "../db.js";
import type { GuestPass, Visit } from "../../generated/prisma/client.js";
import { createVisit, transitionVisit } from "./visits.js";

/** No look-alikes: no 0/O, 1/I/L, so a guard can type what the guest reads out. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

export function newCode(): string {
  return Array.from({ length: CODE_LENGTH }, () =>
    CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length)),
  ).join("");
}

/** What the guard typed, tidied: upper-case, no spaces or dashes ("abcd-2345" → "ABCD2345"). */
export function tidyCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** HMAC-SHA256 with a key derived from the server secret: a stolen database can't reveal codes. */
export function hashCode(code: string): string {
  return createHmac("sha256", `guest-pass:${config.JWT_SECRET}`)
    .update(tidyCode(code))
    .digest("hex");
}

export type PassState = "active" | "not_yet_valid" | "expired" | "used_up" | "revoked";

export function passState(
  pass: Pick<GuestPass, "validFrom" | "validUntil" | "useCount" | "maxUses" | "revokedAt">,
  now: Date,
): PassState {
  if (pass.revokedAt) return "revoked";
  if (pass.useCount >= pass.maxUses) return "used_up";
  if (now < pass.validFrom) return "not_yet_valid";
  if (now >= pass.validUntil) return "expired";
  return "active";
}

/** Take one use of a pass if it is active at `at`. Returns false if someone else got there first. */
export async function consumeUse(tx: Tx, passId: string, at: Date): Promise<boolean> {
  const updated = await tx.$executeRaw`
    UPDATE guest_passes SET use_count = use_count + 1
    WHERE id = ${passId}::uuid AND revoked_at IS NULL AND use_count < max_uses
      AND valid_from <= ${at} AND valid_until > ${at}`;
  return updated === 1;
}

/**
 * Admit a car with a pass: use it once, create the visit already approved, and move it inside.
 * Returns null when the pass could not be used (used up, revoked, outside its window).
 */
export async function admitWithPass(
  tx: Tx,
  passId: string,
  input: { plate: string | null; at: Date; gateEventId: string | null; actorUserId: string | null },
): Promise<Visit | null> {
  if (!(await consumeUse(tx, passId, input.at))) return null;
  const pass = await tx.guestPass.findUniqueOrThrow({ where: { id: passId } });
  const visit = await createVisit(tx, {
    flatId: pass.flatId,
    category: "guest",
    status: "approved",
    guestPassId: pass.id,
    plateNormalized: input.plate ?? pass.plateNormalized,
    purpose: pass.guestName ? `Guest pass: ${pass.guestName}` : "Guest pass",
    createdById: input.actorUserId,
    at: input.at,
  });
  return transitionVisit(tx, visit.id, "enter", {
    at: input.at,
    actorUserId: input.actorUserId,
    gateEventId: input.gateEventId,
  });
}
