/**
 * API base URL.
 * - Empty / unset NEXT_PUBLIC_API_URL → same-origin `/api/...` (uses Next.js rewrites → backend).
 * - Set to full URL (e.g. http://localhost:8000) only if you need direct cross-origin calls.
 */
function apiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (raw === undefined || String(raw).trim() === "") {
    return "";
  }
  return String(raw).replace(/\/$/, "");
}

const _base = apiBase();

export function getApiBase(): string {
  return _base;
}

/** @deprecated use getApiBase(); kept for live page imports */
export const API_URL = _base;

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("va_token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("va_token", token);
  else localStorage.removeItem("va_token");
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const url = path.startsWith("http") ? path : `${_base}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network error";
    throw new Error(
      `${msg}. If the API is running, try empty NEXT_PUBLIC_API_URL in the repo root .env (same-origin proxy).`
    );
  }
  if (!res.ok) {
    const text = await res.text();
    let message = text || res.statusText;
    try {
      const j = JSON.parse(text) as {
        detail?: string | { msg?: string; loc?: unknown[] }[];
      };
      if (typeof j?.detail === "string") message = j.detail;
      else if (Array.isArray(j?.detail)) {
        message = j.detail
          .map((d) => (typeof d === "object" && d && "msg" in d ? String(d.msg) : JSON.stringify(d)))
          .join("; ");
      }
    } catch {
      /* plain text / HTML */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
