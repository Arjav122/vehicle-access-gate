// The visit state machine (brief §10.3), as one lookup table. Pure: no database.
//
//   [*] → pending_approval        [*] → approved (guest pass)
//   pending_approval → approved (approve) | denied (deny) | expired (expire)
//   approved         → inside (enter)     | expired (expire)
//   inside           → overstayed (overstay) | exited (exit)
//   overstayed       → escalated (escalate)  | exited (exit)
//   escalated        → exited (exit)
//
// 8 statuses × 7 triggers = 56 pairs; 10 are legal, every other pair is refused.
import type { VisitStatus, VisitTrigger } from "../../generated/prisma/enums.js";

/** The 7 triggers that move a visit (the database also stores `create` for the first row). */
export type Trigger = Exclude<VisitTrigger, "create">;

export const STATUSES: readonly VisitStatus[] = [
  "pending_approval",
  "approved",
  "denied",
  "expired",
  "inside",
  "overstayed",
  "escalated",
  "exited",
];

export const TRIGGERS: readonly Trigger[] = [
  "approve",
  "deny",
  "expire",
  "enter",
  "overstay",
  "escalate",
  "exit",
];

/** Where a visit may start: waiting for the resident, or already approved by a guest pass. */
export const INITIAL_STATUSES: readonly VisitStatus[] = ["pending_approval", "approved"];

const TABLE: Partial<Record<VisitStatus, Partial<Record<Trigger, VisitStatus>>>> = {
  pending_approval: { approve: "approved", deny: "denied", expire: "expired" },
  approved: { enter: "inside", expire: "expired" },
  inside: { overstay: "overstayed", exit: "exited" },
  overstayed: { escalate: "escalated", exit: "exited" },
  escalated: { exit: "exited" },
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: VisitStatus,
    readonly trigger: Trigger,
  ) {
    super(`A visit that is "${from}" cannot "${trigger}"`);
  }
}

/** The next status, or throws IllegalTransitionError (→ HTTP 409, nothing changes). */
export function nextStatus(from: VisitStatus, trigger: Trigger): VisitStatus {
  const to = TABLE[from]?.[trigger];
  if (!to) throw new IllegalTransitionError(from, trigger);
  return to;
}

/** True when a visit in this status is finished and will never move again. */
export function isFinal(status: VisitStatus): boolean {
  return TRIGGERS.every((t) => TABLE[status]?.[t] === undefined);
}
