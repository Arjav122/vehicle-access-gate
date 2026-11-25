// Pure helpers: plate grouping, formatting, phone normalisation, IST date bounds, and the
// sentence the guard reads for each camera read.
import { describe, expect, it } from "vitest";
import type { Schemas } from "./api";
import {
  arrivalSentence,
  formatCountdown,
  formatMinutes,
  formatPhone,
  formatRelative,
  istDayBound,
  normalizePhone,
  passValidUntil,
} from "./format";
import { formatPlate, plateGroups } from "./plates";
import { INVALIDATES } from "./socket";

describe("plateGroups", () => {
  it.each([
    ["UP16AB1234", ["UP16", "AB", "1234"]],
    ["DL3CAB1234", ["DL3", "CAB", "1234"]],
    ["KA05MN0042", ["KA05", "MN", "0042"]],
    ["HR26DK0091", ["HR26", "DK", "0091"]],
    ["MH12A123", ["MH12", "A", "123"]],
    ["DL1C1234", ["DL1", "C", "1234"]],
    ["22BH1234AA", ["22", "BH", "1234", "AA"]],
    ["21BH7176P", ["21", "BH", "7176", "P"]],
    ["up16 ab-1234", ["UP16", "AB", "1234"]],
    ["UP16 A? 12?4", ["UP16A?12?4"]],
    ["", []],
  ])("%s → %j", (input, groups) => {
    expect(plateGroups(input)).toEqual(groups);
  });

  it("joins groups with spaces for display", () => {
    expect(formatPlate("22BH1234AA")).toBe("22 BH 1234 AA");
  });
});

describe("format", () => {
  it("counts down as m:ss and never goes negative", () => {
    expect(formatCountdown(180)).toBe("3:00");
    expect(formatCountdown(61.2)).toBe("1:02");
    expect(formatCountdown(-5)).toBe("0:00");
  });

  it("formats durations", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 h");
    expect(formatMinutes(130)).toBe("2 h 10 min");
  });

  it("formats relative times both ways", () => {
    const now = new Date("2026-11-26T10:00:00Z");
    expect(formatRelative("2026-11-26T09:59:40Z", now)).toBe("just now");
    expect(formatRelative("2026-11-26T09:55:00Z", now)).toBe("5 min ago");
    expect(formatRelative("2026-11-26T07:00:00Z", now)).toBe("3 h ago");
    expect(formatRelative("2026-11-23T10:00:00Z", now)).toBe("3 days ago");
    expect(formatRelative("2026-11-26T10:20:00Z", now)).toBe("in 20 min");
  });

  it("normalises Indian mobile numbers to +91…", () => {
    expect(normalizePhone("98765 43210")).toBe("+919876543210");
    expect(normalizePhone("919876543210")).toBe("+919876543210");
    expect(normalizePhone("+91 98765-43210")).toBe("+919876543210");
    expect(normalizePhone("12345")).toBe("12345"); // the server rejects it with a clear error
  });

  it("groups a full phone number for dialling", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(formatPhone("+44 20 7946 0000")).toBe("+44 20 7946 0000");
  });

  it("turns an IST calendar day into UTC bounds", () => {
    expect(istDayBound("2026-11-20")).toBe("2026-11-19T18:30:00.000Z");
    expect(istDayBound("2026-11-20", true)).toBe("2026-11-20T18:29:59.999Z");
  });

  it("ends a 'today' guest pass at IST midnight", () => {
    const now = new Date("2026-11-26T20:00:00Z"); // 01:30 IST on the 27th
    expect(passValidUntil("today", now).toISOString()).toBe("2026-11-27T18:29:59.000Z");
    expect(passValidUntil("24h", now).toISOString()).toBe("2026-11-27T20:00:00.000Z");
  });
});

describe("arrivalSentence", () => {
  const event = (over: Partial<Schemas["GateEvent"]>) =>
    ({
      direction: "entry",
      matchResult: "unknown",
      visitId: null,
      vehicle: null,
      ...over,
    }) as Schemas["GateEvent"];

  it("tells the guard what to do, in words", () => {
    expect(arrivalSentence(event({}))).toBe("New car: register the visitor");
    expect(arrivalSentence(event({ visitId: "x" }))).toBe("Registered visitor");
    expect(arrivalSentence(event({ matchResult: "watchlist" }))).toMatch(/stop the car/);
    expect(arrivalSentence(event({ matchResult: "low_confidence" }))).toMatch(/check the plate/);
    expect(
      arrivalSentence(
        event({
          matchResult: "resident",
          direction: "exit",
          vehicle: { id: "v", plate: "UP16AB1234", flatLabel: "B-402" },
        }),
      ),
    ).toBe("Resident car of B-402: exit logged");
  });
});

describe("real-time invalidation map", () => {
  it("refreshes the guard's lists on the events that change them", () => {
    expect(INVALIDATES["gate_event.created"]).toEqual(
      expect.arrayContaining(["gate-events", "review-queue", "inside"]),
    );
    expect(INVALIDATES["approval.decided"]).toEqual(
      expect.arrayContaining(["visits", "approvals", "inside"]),
    );
    expect(INVALIDATES["escalation.created"]).toContain("escalations");
  });
});
