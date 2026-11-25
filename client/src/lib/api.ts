// Typed API client. `schema.d.ts` is generated from the server's OpenAPI document
// (npm run api:types), so a wrong path, query or body is a compile error, and CI fails when the
// committed types drift from the server.
//
// Every request carries the access token; a 401 triggers one refresh and one retry.
import createClient from "openapi-fetch";
import { absoluteUrl, getTokens, refresh } from "./auth";
import type { components, paths } from "./schema";

export type Schemas = components["schemas"];

type JsonBody<O> = O extends { requestBody?: { content: { "application/json": infer B } } }
  ? B
  : never;
/** The JSON body type of an endpoint, e.g. BodyOf<"/api/visits", "post">. */
export type BodyOf<P extends keyof paths, M extends keyof paths[P]> = JsonBody<paths[P][M]>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function withAuth(request: Request): Request {
  const t = getTokens();
  const next = request.clone();
  if (t) next.headers.set("Authorization", `Bearer ${t.accessToken}`);
  return next;
}

async function authedFetch(input: Request): Promise<Response> {
  const res = await fetch(withAuth(input));
  if (res.status !== 401 || !getTokens() || input.url.includes("/api/auth/")) return res;
  return (await refresh()) ? fetch(withAuth(input)) : res;
}

export const api = createClient<paths>({ baseUrl: window.location.origin, fetch: authedFetch });

/** Turn an openapi-fetch result into data, or throw ApiError with the server's `detail`. */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (response.ok) return data as T;
  const detail =
    typeof error === "object" && error && "detail" in error && typeof error.detail === "string"
      ? error.detail
      : response.statusText || "Request failed";
  throw new ApiError(response.status, detail);
}

/** A readable message for any thrown value (for toasts and error states). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return "Can't reach the server. Check your connection.";
  return err instanceof Error ? err.message : "Something went wrong";
}

/** Fetch an image that needs the access token (snapshots) as an object URL. */
export async function fetchImageUrl(path: string): Promise<string> {
  const res = await authedFetch(new Request(absoluteUrl(path)));
  if (!res.ok) throw new ApiError(res.status, "Snapshot not available");
  return URL.createObjectURL(await res.blob());
}

/**
 * Loosely typed request, only for the admin's generic resource tables (one component serves
 * flats, residents, vehicles, guards, gates, devices and the watchlist). Callers state the
 * row type with `Schemas[...]`; everything else in the app uses the typed `api` client.
 */
export async function apiRequest<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await authedFetch(new Request(absoluteUrl(path), init));
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      typeof data === "object" && data && "detail" in data && typeof data.detail === "string"
        ? data.detail
        : res.statusText || "Request failed";
    throw new ApiError(res.status, detail);
  }
  return data as T;
}

/** Download a file that needs the access token (CSV export). */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await authedFetch(new Request(absoluteUrl(path)));
  if (!res.ok) throw new ApiError(res.status, "Export failed");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
