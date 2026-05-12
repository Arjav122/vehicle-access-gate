import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Next.js 14.2 does not support `envDir`; load repo-root `.env` here so `process.env` is populated for rewrites.
dotenv.config({ path: path.join(__dirname, "..", ".env") });

/** Same port resolution as `backend/run.py` (single source of truth for local dev). */
function getApiPort() {
  const raw = String(process.env.API_PORT || process.env.PORT || "8000").trim();
  return /^\d+$/.test(raw) ? raw : "8000";
}

/**
 * Where the Next.js server (Node) proxies `/api/*` in dev/production.
 * Uses `API_PORT` so this cannot drift from `python run.py` / uvicorn.
 * Optional `BACKEND_INTERNAL_URL` for Docker (e.g. http://api:8000).
 * If `BACKEND_INTERNAL_URL` points at localhost with a wrong port vs `API_PORT`, we fix it and log a warning.
 */
function resolveBackendInternal() {
  const port = getApiPort();
  const fallback = `http://127.0.0.1:${port}`;

  const explicit = process.env.BACKEND_INTERNAL_URL?.trim();
  if (explicit) {
    try {
      const u = new URL(explicit);
      const isLoopback = u.hostname === "localhost" || u.hostname === "127.0.0.1";
      const urlPort = u.port || (u.protocol === "https:" ? "443" : u.protocol === "http:" ? "80" : "");
      if (isLoopback && urlPort && urlPort !== port) {
        console.warn(
          `[next.config] BACKEND_INTERNAL_URL uses port ${urlPort} but API_PORT is ${port}. ` +
            `Using ${fallback} for /api rewrites (same as backend). Remove or fix BACKEND_INTERNAL_URL.`
        );
        return fallback;
      }
      return explicit.replace(/\/$/, "");
    } catch {
      console.warn(`[next.config] Invalid BACKEND_INTERNAL_URL; using ${fallback}`);
      return fallback;
    }
  }

  const publicUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (publicUrl) {
    return publicUrl.replace(/\/$/, "");
  }

  return fallback;
}

const backendInternal = resolveBackendInternal();

/** @type {import('next').NextConfig} */
// Dev: browser calls same-origin `/api/...`; Next forwards here (avoids CORS / "Failed to fetch").
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendInternal}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
