// Plate cleaning + validation (Phase 1 part of brief §10.1; Phase 2 adds OCR repair cases).
import { describe, expect, it } from "vitest";
import { cleanPlate, normalizePlate, plateKind } from "../src/services/plates.js";

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

describe("plateKind / normalizePlate", () => {
  it.each([
    ["UP16AB1234", "standard"],
    ["KA05MN0042", "standard"],
    ["DL3CAB1234", "standard"], // Delhi: 1-digit district + 3-letter series
    ["MH12A123", "standard"], // 1-letter series, 3-digit number
    ["TN01AB1", "standard"], // 1-digit number
    ["TG09AB1234", "standard"], // Telangana's new code
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
