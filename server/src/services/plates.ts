// Indian number plates: cleaning, validation, OCR repair and fuzzy matching (brief §10.1).
// Pure functions only (no database), so every rule is easy to test with a table of cases.
// "The camera reads, the server decides": this file is the ONE place plates are interpreted.

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
const FORBIDDEN_IN_SERIES = new Set(["I", "O", "Q"]);

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

// ---------------------------------------------------------------------------
// OCR repair
// ---------------------------------------------------------------------------

/** Characters OCR confuses, both ways. A swap costs 1 "fix". */
const TO_DIGIT: Record<string, string> = {
  O: "0",
  I: "1",
  B: "8",
  S: "5",
  Z: "2",
  G: "6",
  T: "7",
  A: "4",
};
const TO_LETTER: Record<string, string> = Object.fromEntries(
  Object.entries(TO_DIGIT).map(([letter, digit]) => [digit, letter]),
);

/** More look-alike swaps than this and we call the read unreadable. */
export const MAX_FIXES = 3;

/** The HSRP "IND" mark and how OCR misreads it; stripped from either end. */
const IND_PREFIX = /^[I1L]N[D0O]/;
const IND_SUFFIX = /[I1L]N[D0O]$/;

type Slot = "letter" | "digit" | "series";

interface Layout {
  kind: PlateKind;
  district: number;
  series: number;
  number: number;
  slots: Slot[];
}

const repeat = (slot: Slot, n: number): Slot[] => Array.from({ length: n }, () => slot);

/** Every layout a plate of this length could have. */
function layouts(length: number): Layout[] {
  const out: Layout[] = [];
  for (let district = 1; district <= 2; district++) {
    for (let series = 0; series <= 3; series++) {
      const number = length - 2 - district - series;
      if (number < 1 || number > 4) continue;
      out.push({
        kind: "standard",
        district,
        series,
        number,
        slots: [
          ...repeat("letter", 2),
          ...repeat("digit", district),
          ...repeat("series", series),
          ...repeat("digit", number),
        ],
      });
    }
  }
  for (const letters of [1, 2]) {
    if (8 + letters !== length) continue;
    out.push({
      kind: "bh",
      district: 0,
      series: letters,
      number: 4,
      slots: [
        ...repeat("digit", 2),
        ...repeat("letter", 2),
        ...repeat("digit", 4),
        ...repeat("series", letters),
      ],
    });
  }
  return out;
}

/** Fit one character into a slot: the (possibly swapped) character and its cost, or null. */
function fit(ch: string, slot: Slot): { ch: string; cost: number } | null {
  const isDigit = ch >= "0" && ch <= "9";
  if (slot === "digit") {
    if (isDigit) return { ch, cost: 0 };
    const digit = TO_DIGIT[ch];
    return digit ? { ch: digit, cost: 1 } : null;
  }
  let letter = ch;
  let cost = 0;
  if (isDigit) {
    const swapped = TO_LETTER[ch];
    if (!swapped) return null;
    letter = swapped;
    cost = 1;
  }
  if (slot === "series" && FORBIDDEN_IN_SERIES.has(letter)) return null;
  return { ch: letter, cost };
}

/** Small penalties for legal-but-uncommon shapes, so the common reading wins. */
function shapePenalty(layout: Layout, state: string): number {
  if (layout.kind === "bh") return 0;
  let p = 0;
  if (layout.number === 3) p += 0.3;
  else if (layout.number < 3) p += 0.5;
  if (layout.series === 1 || layout.series === 3) p += 0.2;
  else if (layout.series === 0) p += 0.4;
  // 1-digit districts are a Delhi thing (DL3C…). Elsewhere this shape costs a bit MORE than one
  // look-alike swap, so "UP1ZAB1234" is read as UP12AB1234, not as a rare UP1-ZAB plate (§17).
  if (layout.district === 1 && state !== "DL") p += 1.1;
  return p;
}

export interface Repair {
  /** The repaired plate, e.g. KA05MN0042. */
  plate: string;
  /** How many look-alike swaps were needed. */
  fixes: number;
  kind: PlateKind;
  /** fixes + shape penalties; lower is better. */
  score: number;
}

/** Best valid reading of one cleaned string, or null. */
function repairCleaned(text: string): Repair | null {
  let best: Repair | null = null;
  for (const layout of layouts(text.length)) {
    let fixes = 0;
    let out = "";
    for (let i = 0; i < text.length && fixes <= MAX_FIXES; i++) {
      const fitted = fit(text.charAt(i), layout.slots[i] ?? "digit");
      if (!fitted) {
        fixes = MAX_FIXES + 1;
        break;
      }
      out += fitted.ch;
      fixes += fitted.cost;
    }
    if (fixes > MAX_FIXES) continue;
    if (plateKind(out) !== layout.kind) continue; // real state code, "BH", no all-zero parts
    const score = fixes + shapePenalty(layout, out.slice(0, 2));
    if (!best || score < best.score) best = { plate: out, fixes, kind: layout.kind, score };
  }
  return best;
}

/**
 * Turn an OCR read into the most likely valid plate, e.g. "KAO5MNOO42" → "KA05MN0042",
 * "HR76AOOO5IND" → "HR76A0005". Returns null when nothing fits within MAX_FIXES swaps.
 */
export function repairPlate(raw: string): Repair | null {
  const cleaned = cleanPlate(raw);
  const noPrefix = cleaned.replace(IND_PREFIX, "");
  const variants = new Set([
    cleaned,
    noPrefix,
    cleaned.replace(IND_SUFFIX, ""),
    noPrefix.replace(IND_SUFFIX, ""),
  ]);
  let best: Repair | null = null;
  for (const v of variants) {
    const r = repairCleaned(v);
    if (r && (!best || r.score < best.score)) best = r;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Fuzzy matching
// ---------------------------------------------------------------------------

/** Edit distance (insert / delete / substitute), giving up early once it exceeds `max`. */
export function levenshtein(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** Something a plate can match: just its plate and id, never whole rows (brief §17). */
export interface Candidate<K extends string = string> {
  plate: string;
  id: string;
  kind: K;
}

export type MatchOutcome<K extends string> =
  | { type: "none" }
  | { type: "match"; candidate: Candidate<K>; distance: number }
  | { type: "ambiguous"; candidates: Candidate<K>[]; distance: number };

/**
 * The closest candidate within `maxDistance`. Exact beats fuzzy. If two different candidates
 * are equally close we do not guess: the read goes to a guard as "ambiguous".
 */
export function bestMatch<K extends string>(
  plate: string,
  candidates: Candidate<K>[],
  maxDistance: number,
): MatchOutcome<K> {
  let best = maxDistance + 1;
  let winners: Candidate<K>[] = [];
  for (const c of candidates) {
    const d =
      c.plate === plate
        ? 0
        : best === 0
          ? best + 1
          : levenshtein(plate, c.plate, Math.min(best, maxDistance));
    if (d > maxDistance || d > best) continue;
    if (d < best) {
      best = d;
      winners = [];
    }
    winners.push(c);
  }
  const [first] = winners;
  if (!first) return { type: "none" };
  if (winners.length === 1) return { type: "match", candidate: first, distance: best };
  return { type: "ambiguous", candidates: winners, distance: best };
}
