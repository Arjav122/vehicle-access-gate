// Token store: the access + refresh token live in memory and are mirrored to localStorage so a
// page reload stays signed in. Everything reads the in-memory copy (brief §17: a test that only
// writes localStorage does not sign in; sign in for real).
//
// refresh() is single-flight: ten requests that hit 401 at once trigger ONE refresh call. That
// matters because refresh tokens are single-use: a second parallel refresh would look like token
// reuse and the server would revoke every session of the user.

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

const STORAGE_KEY = "vehicle-access.tokens";

/** "/api/x" → "http://<this page's origin>/api/x" (Request() in tests needs absolute URLs). */
export const absoluteUrl = (path: string): string => new URL(path, window.location.origin).href;
let tokens: Tokens | null = load();
const listeners = new Set<() => void>();

function load(): Tokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Tokens>;
    return typeof parsed.accessToken === "string" && typeof parsed.refreshToken === "string"
      ? { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken }
      : null;
  } catch {
    return null;
  }
}

export const getTokens = (): Tokens | null => tokens;

export function setTokens(next: Tokens | null): void {
  tokens = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked (private mode): memory still works for this tab
  }
  for (const l of listeners) l();
}

/** Re-render on sign in / sign out. Returns an unsubscribe function. */
export function onTokensChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let inFlight: Promise<boolean> | null = null;

/** Swap the refresh token for a new pair. false (and signed out) when it is no longer valid. */
export function refresh(): Promise<boolean> {
  inFlight ??= (async () => {
    const current = tokens;
    if (!current) return false;
    try {
      const res = await fetch(absoluteUrl("/api/auth/refresh"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (!res.ok) {
        // Only sign out if nobody signed in again meanwhile.
        if (tokens === current) setTokens(null);
        return false;
      }
      const pair = (await res.json()) as Tokens;
      setTokens({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
      return true;
    } catch {
      return false; // offline: keep the tokens, try again later
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
