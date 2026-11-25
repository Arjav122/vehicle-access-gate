// Display grouping for Indian plates, as printed on an HSRP plate:
//   UP16AB1234   → ["UP16", "AB", "1234"]
//   DL3CAB1234   → ["DL3", "CAB", "1234"]
//   22BH1234AA   → ["22", "BH", "1234", "AA"]
// The server owns repair and validation (services/plates.ts); this only splits for display.
// Anything that does not look like a plate (an unclear read) is shown as one group.

const STANDARD = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/;
const BH = /^(\d{2})(BH)(\d{4})([A-Z]{1,2})$/;

export function plateGroups(plate: string): string[] {
  const clean = plate.toUpperCase().replace(/[^A-Z0-9?]/g, "");
  const bh = BH.exec(clean);
  if (bh) return bh.slice(1);
  const std = STANDARD.exec(clean);
  if (std) {
    const [, state = "", district = "", series = "", number = ""] = std;
    return [state + district, series, number].filter(Boolean);
  }
  return clean ? [clean] : [];
}

/** "UP16 AB 1234" */
export const formatPlate = (plate: string): string => plateGroups(plate).join(" ");
