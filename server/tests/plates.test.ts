// Plate cleaning, validation, OCR repair and fuzzy matching (brief §10.1).
import { describe, expect, it } from "vitest";
import {
  bestMatch,
  type Candidate,
  cleanPlate,
  levenshtein,
  MAX_FIXES,
  normalizePlate,
  plateKind,
  repairPlate,
} from "../src/services/plates.js";

describe("cleanPlate", () => {
  it.each([
    ["up16 ab 1234", "UP16AB1234"],
    ["UP-16-AB-1234", "UP16AB1234"],
    ["  dl3c.ab.0042 ", "DL3CAB0042"],
    ["22 BH 1234 AA", "22BH1234AA"],
  ])("%s → %s", (input, expected) => {
    expect(cleanPlate(input)).toBe(expected);
  });
});

describe("plateKind / normalizePlate (typed plates are validated, never repaired)", () => {
  it.each([
    ["UP16AB1234", "standard"],
    ["KA05MN0042", "standard"],
    ["DL3CAB1234", "standard"],
    ["MH12A123", "standard"],
    ["TN01AB1", "standard"],
    ["TG09AB1234", "standard"],
    ["HR26DK0091", "standard"],
    ["22BH1234AA", "bh"],
    ["23BH0001A", "bh"],
  ])("%s is a valid %s plate", (plate, kind) => {
    expect(plateKind(plate)).toBe(kind);
    expect(normalizePlate(plate)).toBe(plate);
  });

  it.each([
    ["XX16AB1234", "unknown state code"],
    ["UP00AB1234", "district 00"],
    ["UP16AB0000", "number 0000"],
    ["UP16IO1234", "I and O never appear in a series"],
    ["UP16QA1234", "Q never appears in a series"],
    ["UP16ABCD1234", "4-letter series"],
    ["UP16AB12345", "5-digit number"],
    ["22BH0000AA", "BH number 0000"],
    ["22BH1234", "BH without letters"],
    ["22BH1234IO", "BH letters I/O"],
    ["1234", "digits only"],
    ["", "empty"],
  ])("%s is rejected (%s)", (plate) => {
    expect(plateKind(plate)).toBeNull();
  });

  it("cleans before validating", () => {
    expect(normalizePlate("up 16 ab-1234")).toBe("UP16AB1234");
    expect(normalizePlate("not a plate")).toBeNull();
  });
});

describe("repairPlate: OCR reads → most likely valid plate", () => {
  it.each([
    // already correct
    ["UP16AB1234", "UP16AB1234", 0],
    ["up 16 ab-1234", "UP16AB1234", 0],
    ["KA05MN0042", "KA05MN0042", 0],
    ["22BH1234AA", "22BH1234AA", 0],
    ["MH12A123", "MH12A123", 0],
    ["WB02AJ12", "WB02AJ12", 0],
    // the brief's example: O in digit slots becomes 0
    ["KAO5MNOO42", "KA05MN0042", 3],
    // look-alikes in digit slots
    ["MH12DEI433", "MH12DE1433", 1],
    ["UPI6ABI234", "UP16AB1234", 2],
    ["HR26DK0O91", "HR26DK0091", 1],
    ["HR26DKOO91", "HR26DK0091", 2],
    ["GJ0IRX5678", "GJ01RX5678", 1],
    ["UP16BT44II", "UP16BT4411", 2],
    ["DL8CAF72O3", "DL8CAF7203", 1],
    ["UP16ABI2S4", "UP16AB1254", 2],
    ["TN0IAB1234", "TN01AB1234", 1],
    ["UPI6ABIZ34", "UP16AB1234", 3],
    // look-alikes in letter slots
    ["UP16A81234", "UP16AB1234", 1],
    ["0D02AB1234", "OD02AB1234", 1],
    ["5K01AB1234", "SK01AB1234", 1],
    ["8R01AB1234", "BR01AB1234", 1],
    ["UP165T1234", "UP16ST1234", 1],
    // Bharat series
    ["22BHI234AA", "22BH1234AA", 1],
    ["2ZBH1234AA", "22BH1234AA", 1],
    ["22BH1234A4", "22BH1234AA", 1],
    ["22 BH 1234 A", "22BH1234A", 0],
    // the HSRP "IND" mark (and how OCR misreads it) at either end
    ["UP16AB1234IND", "UP16AB1234", 0],
    ["INDUP16AB1234", "UP16AB1234", 0],
    ["UP16AB1234INO", "UP16AB1234", 0],
    ["UP16AB1234IN0", "UP16AB1234", 0],
    ["1NDUP16AB1234", "UP16AB1234", 0],
    ["IND UP16 AB 1234 IND", "UP16AB1234", 0],
    ["HR76AOOO5IND", "HR76A0005", 3],
    // shape preferences
    ["DL3CAB1234", "DL3CAB1234", 0], // Delhi's 1-digit district is normal
    ["UP1ZAB1234", "UP12AB1234", 1], // elsewhere, one swap beats a rare 1-digit district
  ])("%s → %s (%i fixes)", (raw, plate, fixes) => {
    const r = repairPlate(raw);
    expect(r?.plate).toBe(plate);
    expect(r?.fixes).toBe(fixes);
    expect(plateKind(r?.plate ?? "")).not.toBeNull();
  });

  it.each([
    ["XX16AB1234", "not a state, and no swap makes one"],
    ["UP16AB0000", "number 0000"],
    ["UP16ABCD1234", "too long for any layout"],
    ["UP16AB12345", "5-digit number"],
    ["UPI6ABIZ3A", `more than ${String(MAX_FIXES)} swaps needed`],
    ["UP16ABI2E4", "E is not a digit look-alike"],
    ["22BH1234IO", "I/O are never series letters"],
    ["IND", "only the IND mark"],
    ["U", "too short"],
    ["", "empty"],
  ])("%s is unreadable (%s)", (raw) => {
    expect(repairPlate(raw)).toBeNull();
  });

  it("never produces I, O or Q in a series", () => {
    for (const raw of ["UP16I01234", "UP1601234", "UP16O1234", "DL1C0A1234"]) {
      const r = repairPlate(raw);
      if (r) expect(r.plate.slice(4)).not.toMatch(/[IOQ]/);
    }
  });
});

describe("levenshtein", () => {
  it.each([
    ["UP16AB1234", "UP16AB1234", 0],
    ["UP16AB1234", "UP16AB1235", 1],
    ["UP16AB1234", "UP16AB123", 1],
    ["UP16AB1234", "UP16AAB1234", 1],
    ["UP16AB1234", "UP61AB1234", 2],
    ["", "ABC", 3],
  ])("%s ↔ %s = %i", (a, b, d) => {
    expect(levenshtein(a, b)).toBe(d);
    expect(levenshtein(b, a)).toBe(d);
  });

  it("gives up early above the limit", () => {
    expect(levenshtein("UP16AB1234", "KA05MN0042", 1)).toBe(2);
    expect(levenshtein("AB", "ABCDEF", 1)).toBe(2);
  });
});

describe("bestMatch", () => {
  const c = (plate: string, id: string, kind = "vehicle"): Candidate => ({ plate, id, kind });

  it("exact beats fuzzy", () => {
    const out = bestMatch("UP16AB1234", [c("UP16AB1235", "fuzzy"), c("UP16AB1234", "exact")], 1);
    expect(out).toEqual({ type: "match", candidate: c("UP16AB1234", "exact"), distance: 0 });
  });

  it("finds a single plate one edit away", () => {
    const out = bestMatch("UP16AB1234", [c("UP16AB1284", "a"), c("KA05MN0042", "b")], 1);
    expect(out).toMatchObject({ type: "match", candidate: { id: "a" }, distance: 1 });
  });

  it("refuses to guess between two equally close plates", () => {
    const out = bestMatch("UP16AB1234", [c("UP16AB1235", "a"), c("UP16AB1236", "b")], 1);
    expect(out).toMatchObject({ type: "ambiguous", distance: 1 });
    if (out.type === "ambiguous") expect(out.candidates.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("ignores anything beyond the max distance, and an empty list", () => {
    expect(bestMatch("UP16AB1234", [c("UP16AB5678", "a")], 1)).toEqual({ type: "none" });
    expect(bestMatch("UP16AB1234", [], 1)).toEqual({ type: "none" });
  });

  it("with max distance 0 only exact plates match", () => {
    expect(bestMatch("UP16AB1234", [c("UP16AB1235", "a")], 0)).toEqual({ type: "none" });
  });
});
