// Database access: one Prisma client, a transaction helper, and the mapping from
// database constraint errors to clear HTTP answers (409 / 404).
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "./config.js";
import { Prisma, PrismaClient } from "../generated/prisma/client.js";

// The pg driver adapter sends plain (unnamed) queries, so it also works through
// Supabase's transaction pooler (port 6543). See docs/decisions.md D8.
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.DATABASE_URL }),
});

/** A Prisma transaction client. Services take this so callers decide the transaction. */
export type Tx = Prisma.TransactionClient;

/** Run `fn` in one database transaction: everything commits together or nothing does. */
export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}

/** Readable messages for our named unique constraints. */
const UNIQUE_MESSAGES: Record<string, string> = {
  users_email_key: "A user with this email already exists",
  flats_block_number_key: "This flat already exists",
  vehicles_plate_normalized_key: "A vehicle with this plate is already registered",
  watchlist_plate_normalized_key: "This plate is already on the watchlist",
  gates_name_key: "A gate with this name already exists",
  devices_gate_name_key: "This gate already has a device with this name",
  residents_user_flat_key: "This person is already linked to this flat",
  residents_one_primary_per_flat_key: "This flat already has a primary contact",
};

export interface DbErrorAnswer {
  status: 404 | 409;
  detail: string;
}

/**
 * Turn a database constraint violation into an HTTP answer, or return null when the
 * error is something else (a real bug, which should stay a 500).
 */
export function describeDbError(err: unknown): DbErrorAnswer | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;

  switch (err.code) {
    case "P2002": {
      const name = constraintName(err);
      return {
        status: 409,
        detail: (name && UNIQUE_MESSAGES[name]) ?? "This record conflicts with an existing one",
      };
    }
    case "P2003":
      return { status: 409, detail: "This record is still in use and cannot be deleted" };
    case "P2025":
      return { status: 404, detail: "Not found" };
    default:
      return null;
  }
}

/** The violated constraint's name, from whichever field this Prisma version puts it in. */
function constraintName(err: Prisma.PrismaClientKnownRequestError): string | undefined {
  const text = JSON.stringify(err.meta ?? {}) + err.message;
  return Object.keys(UNIQUE_MESSAGES).find((name) => text.includes(name));
}
