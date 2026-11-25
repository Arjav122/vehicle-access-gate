// Test helpers: a fake API (routes "GET /api/me" → JSON) installed as global fetch, and a
// render() that wraps a screen in the real providers (fresh query cache) and a memory router.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";

export type Handler = (req: Request) => unknown;
export interface Call {
  method: string;
  path: string;
  body: unknown;
}

/**
 * Replace fetch with a router. `routes` keys are "METHOD /path" (no query string). A handler's
 * return value is sent as JSON with 200; return `new Response(...)` for anything else.
 * Unknown routes answer 404. Returns the list of calls made, for assertions.
 */
export function mockApi(routes: Record<string, Handler | object>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string, init?: RequestInit) => {
      const req = typeof input === "string" ? new Request(input, init) : input;
      const url = new URL(req.url);
      const text = req.method === "GET" ? "" : await req.clone().text();
      calls.push({ method: req.method, path: url.pathname, body: text ? JSON.parse(text) : null });
      const route = routes[`${req.method} ${url.pathname}`];
      if (route === undefined) {
        return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
      }
      const result = typeof route === "function" ? (route as Handler)(req) : route;
      if (result instanceof Response) return result;
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** Render `element` at `path` (other paths render their name, so redirects can be asserted). */
export function renderAt(
  element: ReactNode,
  {
    path = "/",
    at = path,
    client = testQueryClient(),
  }: { path?: string; at?: string; client?: QueryClient } = {},
) {
  const router = createMemoryRouter(
    [
      { path, element },
      { path: "*", element: <p>Page: {"route"}</p> },
    ],
    { initialEntries: [at] },
  );
  const utils = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, client };
}

export const ME = {
  guard: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "guard@example.com",
    fullName: "Ramesh Kumar",
    phone: null,
    role: "guard",
    flats: [],
  },
  resident: {
    id: "00000000-0000-4000-8000-000000000002",
    email: "resident@example.com",
    fullName: "Priya Sharma",
    phone: null,
    role: "resident",
    flats: [
      {
        id: "00000000-0000-4000-8000-0000000000f1",
        label: "A-101",
        residentType: "owner",
        isPrimaryContact: true,
      },
    ],
  },
} as const;
