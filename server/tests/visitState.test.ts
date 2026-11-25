// Every one of the 56 (status, trigger) pairs (brief §10.3).
import { describe, expect, it } from "vitest";
import {
  IllegalTransitionError,
  isFinal,
  nextStatus,
  STATUSES,
  TRIGGERS,
} from "../src/services/visitState.js";

const LEGAL: Record<string, string> = {
  "pending_approval + approve": "approved",
  "pending_approval + deny": "denied",
  "pending_approval + expire": "expired",
  "approved + enter": "inside",
  "approved + expire": "expired",
  "inside + overstay": "overstayed",
  "inside + exit": "exited",
  "overstayed + escalate": "escalated",
  "overstayed + exit": "exited",
  "escalated + exit": "exited",
};

const pairs = STATUSES.flatMap((s) => TRIGGERS.map((t) => [s, t] as const));

describe("visit state machine", () => {
  it("has 8 statuses, 7 triggers, 56 pairs, 10 legal moves", () => {
    expect(STATUSES).toHaveLength(8);
    expect(TRIGGERS).toHaveLength(7);
    expect(pairs).toHaveLength(56);
    expect(Object.keys(LEGAL)).toHaveLength(10);
  });

  it.each(pairs)("%s + %s", (status, trigger) => {
    const expected = LEGAL[`${status} + ${trigger}`];
    if (expected) {
      expect(nextStatus(status, trigger)).toBe(expected);
    } else {
      expect(() => nextStatus(status, trigger)).toThrow(IllegalTransitionError);
    }
  });

  it("denied, expired and exited are final", () => {
    expect(STATUSES.filter(isFinal)).toEqual(["denied", "expired", "exited"]);
  });

  it("explains a refused move", () => {
    expect(() => nextStatus("exited", "enter")).toThrow('A visit that is "exited" cannot "enter"');
  });
});
