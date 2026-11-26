# Deployment

> **Status: not deployed yet.** This is the plan reviewed with the owner on 2026-11-26.
> Deployment (Phase 8 of the brief) runs after the owner has checked the finished project.
> The production files below (`docker-compose.prod.yml`, `Caddyfile`, production Dockerfiles,
> `deploy.yml`) are written in that phase and tested locally before any server is touched.

## Recommended setup: one small always-on server + Supabase

```
Internet ──HTTPS──► Caddy (VM)
                     ├─ serves the React build
                     ├─ /api, /socket.io ──► Node API (+ scheduled jobs, RUN_JOBS=true)
                     └─ simulator (demo traffic through the public API)
Node API ──────────► Supabase Postgres (pooled 6543 for the app, direct 5432 for migrations)
Laptop + webcam (ANPR worker) ──HTTPS + device key──► the same public URL
```

**Why not a free PaaS:** free web services sleep when idle. Render's free tier (checked
2026-11-26) still spins a service down after 15 minutes without traffic and takes about a minute
to wake. While asleep, the approval timeouts, the escalation ladder, the nightly jobs and the
simulator all stop. A split setup (Vercel for the client, Render for the API, Supabase) works for
browsing, but the demo would look dead between visits.

## Free tiers checked (2026-11-26)

| Service | What matters here |
|---|---|
| Oracle Cloud Always Free (Ampere A1) | Recent reports say the allowance was cut from 4 OCPUs / 24 GB to **2 OCPUs / 12 GB** in June 2026; Oracle's own pages conflict, so confirm in the account. Either is enough. Sign-up needs a card for verification; free ARM capacity can be "out of capacity" in a region. Check Oracle's idle-instance policy before relying on it. |
| Supabase Free | **500 MB database per project**, 2 active projects, **paused after a week of low activity**. The simulator's traffic keeps it active; the demo data is far below 500 MB. Use a **new project** (the existing one holds v1 data). |
| Fallback | A small paid VPS (a few dollars a month); compare current prices at deployment time. |
| HTTPS name | `<server-ip>.sslip.io` works without buying a domain; Caddy gets the certificate automatically. |

## What the owner does (accounts and secrets stay with you)

1. Create the cloud account and an Ubuntu VM (ARM is fine). Add your SSH public key, and open
   ports 80 and 443 in both the cloud firewall and the VM's firewall.
2. Create a **new** Supabase project. Copy the **pooled** connection string (port 6543, add
   `?pgbouncer=true`) and the **direct** one (port 5432). Put them in the server's `.env` on the VM,
   never in chat or git.
3. Generate secrets on the VM: `JWT_SECRET` (at least 32 random characters), and a new
   `DEMO_PASSWORD` that you use nowhere else (it is public in demo mode by design).
4. Optional: a transactional-email account for real overstay emails (SMTP settings). Without it,
   production emails are only recorded in the admin's delivery log.
5. Optional: add GitHub secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and
   `DEPLOY_KNOWN_HOSTS` (the server's pinned host key) for automatic deploys.

## Production environment variables

Everything is documented in [`.env.example`](../.env.example). The ones that differ from development:

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` (the server refuses to start with the default `JWT_SECRET`) |
| `DATABASE_URL` | Supabase pooled URL, port 6543, `?pgbouncer=true`, SSL |
| `DIRECT_URL` | Supabase direct URL, port 5432 (migrations only) |
| `JWT_SECRET` | 32+ random characters |
| `CORS_ORIGINS` | empty: one origin behind Caddy, no CORS needed |
| `PUBLIC_BASE_URL` | `https://<server-ip>.sslip.io` (links in emails) |
| `RUN_JOBS` | `true` (exactly one API process) |
| `DEMO_MODE` / `DEMO_PASSWORD` | `true` / your new demo password (public demo only) |
| `SMTP_*` | your email provider, or leave unset |
| `SNAPSHOT_STORAGE` | `local` (a Docker volume); S3-compatible storage optional |

## Work in the deployment phase

- Multi-stage production Dockerfiles (non-root, health checks); the client built to static files.
- `docker-compose.prod.yml`:
  - a one-shot `prisma migrate deploy` against `DIRECT_URL`;
  - the API with `RUN_JOBS=true`;
  - the simulator;
  - Caddy;
  - a `local-db` profile with Postgres for anyone without Supabase.
- `Caddyfile`:
  - automatic HTTPS;
  - serves the build;
  - proxies `/api` and `/socket.io`;
  - hides internal endpoints;
  - adds a Content-Security-Policy for the app.
- `trust proxy` in the API, so the rate limits see real client IPs instead of Caddy's.
- `.github/workflows/deploy.yml`:
  - on green `main`, build the images and push them to GHCR (`latest` + commit SHA);
  - SSH deploy only if the `DEPLOY_*` secrets exist;
  - rolling back means running an older SHA.
- After the first deploy: seed the demo, start the simulator, check the demo logins and the
  nightly reset, then add the live link and badge to the README.

Sources for the free-tier facts:
- [Oracle Always Free resources](https://docs.oracle.com/iaas/Content/FreeTier/resourceref.htm)
- [InfoQ on the 2026 A1 change](https://infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase project pausing](https://supabase.com/kb/faqs/platform/free-project-pausing)
- [Render free tier](https://render.com/docs/free)
