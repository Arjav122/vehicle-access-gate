// Indian number plates: cleaning and format validation (pure functions, no database).
// Phase 1 covers what admins type (vehicles, watchlist). Phase 2 adds OCR repair
// (look-alike swaps such as O↔0, the HSRP "IND" mark) and fuzzy matching (brief §10.1).

/** Current and still-seen state / union territory codes. */
export const STATE_CODES = new Set([
  "AN",
  "AP",
  "AR",
  "AS",
  "BR",
  "CG",
  "CH",
  "DD",
  "DL",
  "DN",
  "GA",
  "GJ",
  "HP",
  "HR",
  "JH",
  "JK",
  "KA",
  "KL",
  "LA",
  "LD",
  "MH",
  "ML",
  "MN",
  "MP",
  "MZ",
  "NL",
  "OD",
  "OR",
  "PB",
  "PY",
  "RJ",
  "SK",
  "TG",
  "TN",
  "TR",
  "TS",
  "UA",
  "UK",
  "UP",
  "WB",
]);

// Series letters never use I, O or Q (they look like 1 and 0).
const SERIES = "[A-HJ-NPR-Z]";

/** State + district (1–2 digits) + series (0–3 letters) + number (1–4 digits), e.g. UP16AB1234. */
const STANDARD = new RegExp(`^([A-Z]{2})(\\d{1,2})(${SERIES}{0,3})(\\d{1,4})$`);
/** Bharat series: year (2 digits) + BH + 4 digits + 1–2 letters, e.g. 22BH1234AA. */
const BHARAT = new RegExp(`^(\\d{2})BH(\\d{4})(${SERIES}{1,2})$`);

/** Upper-case and drop everything except letters and digits ("up16 ab-1234" → "UP16AB1234"). */
export function cleanPlate(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type PlateKind = "standard" | "bh";

/** Which valid layout a cleaned plate has, or null if it is not a valid Indian plate. */
export function plateKind(plate: string): PlateKind | null {
  const standard = STANDARD.exec(plate);
  if (standard) {
    const [, state = "", district = "", , number = ""] = standard;
    if (!STATE_CODES.has(state)) return null;
    if (/^0+$/.test(district) || /^0+$/.test(number)) return null;
    return "standard";
  }
  const bh = BHARAT.exec(plate);
  if (bh && !/^0+$/.test(bh[2] ?? "")) return "bh";
  return null;
}

/** Clean a typed plate and check it; returns the stored form or null if invalid. */
export function normalizePlate(input: string): string | null {
  const plate = cleanPlate(input);
  return plateKind(plate) ? plate : null;
}
