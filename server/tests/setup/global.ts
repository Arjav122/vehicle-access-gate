// Once per test run: create the test database if needed and apply every migration to it.
import { execSync } from "node:child_process";
import pg from "pg";

export default async function setup(): Promise<void> {
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      "postgresql://vehicle_access:vehicle_access@127.0.0.1:5432/vehicle_access_test",
  );
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(dbName))
    throw new Error(`Refusing to test against "${dbName}": name must end in _test`);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DIRECT_URL: url.toString(), DATABASE_URL: url.toString() },
  });
}
