// Real time: ONE Socket.io connection per browser tab, opened while signed in.
// Events never patch cached data; they invalidate the queries that show it, and those screens
// refetch (one source of truth: the API). After a reconnect everything is refetched, because
// events sent while we were offline are lost.
import type { QueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { getTokens, refresh } from "./auth";

export type EventType =
  | "gate_event.created"
  | "alert.created"
  | "approval.requested"
  | "approval.decided"
  | "approval.timed_out"
  | "visit.updated"
  | "escalation.created"
  | "escalation.resolved";

export interface RealtimeEvent {
  type: EventType;
  at: string;
  data: unknown;
}

/** Which query keys (first segment) each event makes stale. */
export const INVALIDATES: Record<EventType, string[]> = {
  "gate_event.created": ["gate-events", "review-queue", "inside", "analytics"],
  "alert.created": ["alerts"],
  "approval.requested": ["visits", "approvals"],
  "approval.decided": ["visits", "approvals", "inside"],
  "approval.timed_out": ["visits", "approvals"],
  "visit.updated": ["visits", "approvals", "inside", "gate-events", "analytics"],
  "escalation.created": ["escalations", "visits"],
  "escalation.resolved": ["escalations", "visits"],
};

export function invalidateFor(client: QueryClient, type: EventType): void {
  for (const key of INVALIDATES[type]) void client.invalidateQueries({ queryKey: [key] });
}

export type ConnectionState = "connecting" | "live" | "offline";

/**
 * Connect and keep the cache fresh. Returns a disconnect function.
 * `onEvent` is for side effects such as toasts.
 */
export function connectRealtime(
  client: QueryClient,
  onEvent: (e: RealtimeEvent) => void,
  onState: (s: ConnectionState) => void,
): () => void {
  // `auth` as a function: every (re)connect sends the CURRENT access token.
  const socket: Socket = io({
    path: "/socket.io",
    auth: (cb) => {
      cb({ token: getTokens()?.accessToken ?? "" });
    },
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
  });
  let everConnected = false;

  socket.on("connect", () => {
    onState("live");
    if (everConnected) void client.invalidateQueries(); // missed events: refetch everything
    everConnected = true;
  });
  socket.on("disconnect", () => {
    onState("offline");
  });
  socket.on("connect_error", (err) => {
    onState("offline");
    // The access token expired: refresh it, then try again (the auth callback sends the new one).
    if (err.message === "unauthorized") {
      void refresh().then((ok) => {
        if (ok) socket.connect();
      });
    }
  });

  const types = Object.keys(INVALIDATES) as EventType[];
  for (const type of types) {
    socket.on(type, (event: RealtimeEvent) => {
      invalidateFor(client, type);
      onEvent(event);
    });
  }
  onState("connecting");
  return () => {
    socket.disconnect();
  };
}
