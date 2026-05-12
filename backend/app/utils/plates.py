import re

# Standard current format: AA + 2-digit district + 1–2 letters + 4 digits (e.g. HR26DK8337, MH12AB1234).
_INDIAN_STANDARD_PLATE = re.compile(r"^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$")


def normalize_plate(raw: str) -> str:
    if not raw:
        return ""
    s = re.sub(r"[^A-Za-z0-9]", "", raw).upper()
    return s


def looks_like_plate(text: str) -> bool:
    t = normalize_plate(text)
    if len(t) < 6 or len(t) > 15:
        return False
    if not re.search(r"\d", t):
        return False
    if not re.search(r"[A-Z]", t):
        return False
    return True


def refine_indian_plate_ocr(norm: str) -> str:
    """
    Fix common EasyOCR letter→digit swaps in the **two mandatory district digits**
    (indices 2 and 3 after the 2-letter state code).

    Example: HRZSDK8337 → HR26DK8337 (Z→2, S→6).

    Only returns a changed string when it matches ``_INDIAN_STANDARD_PLATE``;
    otherwise returns the input unchanged. Does not loosen DB matching —
    it only improves the extracted string before authorization.
    """
    t = normalize_plate(norm)
    if not t or _INDIAN_STANDARD_PLATE.match(t):
        return t
    if len(t) < 4:
        return t
    if not (t[0].isalpha() and t[1].isalpha()):
        return t
    d2, d3 = t[2], t[3]
    if d2.isdigit() and d3.isdigit():
        return t

    def _digit_options(ch: str) -> list[str]:
        if ch.isdigit():
            return [ch]
        c = ch.upper()
        # Order matters when multiple digits are tried: prefer visually likely fixes first.
        table: dict[str, list[str]] = {
            "O": ["0"],
            "Q": ["0"],
            "D": ["0"],
            "U": ["0"],
            "Z": ["2"],
            "I": ["1"],
            "L": ["1"],
            "T": ["1"],
            "J": ["1"],
            # S is often misread from 6 (and sometimes 5); try 6 first.
            "S": ["6", "5", "8"],
            "B": ["8", "6"],
            "G": ["6", "0"],
            "A": ["4"],
        }
        return table.get(c, [c])

    for a in _digit_options(d2):
        for b in _digit_options(d3):
            candidate = t[:2] + a + b + t[4:]
            if _INDIAN_STANDARD_PLATE.match(candidate):
                return candidate
    return t
