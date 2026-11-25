// Real time (brief §9): one Socket.io connection per browser tab.
// - Connecting needs a valid access token (handshake `auth.token`); a bad token is refused.
// - Rooms: "staff" (admins and guards) and "user:<id>" (everyone, for their own events).
// - Events are `{ type, at, data }`, sent AFTER the database transaction commits. A failed send is
//   logged, never fatal: screens refetch on reconnect anyway.
// One server instance, so no Redis adapter yet (docs/decisions.md D12).
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { logger } from "./middleware.js";
import { verifyAccessToken } from "./services/auth.js";

let io: Server | null = null;

export type EventType =
  | "gate_event.created"
  | "alert.created"
  | "approval.requested"
  | "approval.decided"
  | "approval.timed_out"
  | "visit.updated"
  | "escalation.created"
  | "escalation.resolved";

export interface Audience {
  /** Admins and guards. */
  staff?: boolean;
  /** Every active resident of this flat. */
  flatId?: string;
}

export function initRealtime(server: HttpServer): Server {
  io = new Server(server, {
    path: "/socket.io",
    cors: { origin: config.CORS_ORIGINS, credentials: false },
  });

  io.use((socket, next) => {
    const auth: unknown = socket.handshake.auth;
    const token =
      typeof auth === "object" && auth && "token" in auth && typeof auth.token === "string"
        ? auth.token
        : "";
    void (async () => {
      const userId = token ? await verifyAccessToken(token) : null;
      const user = userId
        ? await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, isActive: true },
          })
        : null;
      if (!user?.isActive) {
        next(new Error("unauthorized"));
        return;
      }
      socket.data = { userId: user.id, role: user.role };
      next();
    })().catch((err: unknown) => {
      next(err instanceof Error ? err : new Error("unauthorized"));
    });
  });

  io.on("connection", (socket) => {
    const data = socket.data as { userId: string; role: string };
    void socket.join(`user:${data.userId}`);
    if (data.role === "admin" || data.role === "guard") void socket.join("staff");
  });
  return io;
}

export async function closeRealtime(): Promise<void> {
  if (!io) return;
  await io.close();
  io = null;
}

/** Send an event to its audience. Call only after the transaction has committed. */
export async function publish(type: EventType, data: unknown, audience: Audience): Promise<void> {
  if (!io) return;
  try {
    const rooms: string[] = [];
    if (audience.staff) rooms.push("staff");
    if (audience.flatId) {
      const residents = await prisma.resident.findMany({
        where: { flatId: audience.flatId, user: { isActive: true } },
        select: { userId: true },
      });
      rooms.push(...residents.map((r) => `user:${r.userId}`));
    }
    if (rooms.length) io.to(rooms).emit(type, { type, at: new Date().toISOString(), data });
  } catch (err) {
    logger.warn({ err, type }, "real-time publish failed");
  }
}
