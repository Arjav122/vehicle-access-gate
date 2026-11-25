// Prisma CLI config (Prisma 7 moved the database URL out of schema.prisma into this file).
// Migrations use DIRECT_URL (Supabase: the direct/session connection, port 5432), because the
// transaction pooler cannot run migrations. Env vars come from the process only: this file
// deliberately does NOT load any .env file, so a stray URL can never be migrated by accident.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
