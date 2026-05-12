/**
 * FastAPI JSON routes under `/api/v1`.
 * In local dev, Next.js rewrites same-origin `/api/*` to the backend (see `next.config.mjs`).
 */
export const API_V1 = "/api/v1" as const;

/** Build a path under `/api/v1`, e.g. `apiV1("/residents")` → `/api/v1/residents`. */
export function apiV1(suffix: string): string {
  const normalized = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${API_V1}${normalized}`;
}
