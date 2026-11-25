// The guard console's server data. Each list refetches on real-time events (lib/socket.ts)
// and also on a slow timer as a safety net.
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";

export function useOpenAlerts() {
  return useQuery({
    queryKey: ["alerts", { acknowledged: false }],
    queryFn: () =>
      unwrap(api.GET("/api/alerts", { params: { query: { acknowledged: "false", limit: 20 } } })),
    refetchInterval: 60_000,
  });
}

export function useReviewQueue() {
  return useQuery({
    queryKey: ["review-queue"],
    queryFn: () =>
      unwrap(api.GET("/api/gate-events/review-queue", { params: { query: { limit: 20 } } })),
    refetchInterval: 60_000,
  });
}

export function useCallTasks() {
  return useQuery({
    queryKey: ["escalations", { status: "open" }],
    queryFn: () =>
      unwrap(api.GET("/api/escalations", { params: { query: { status: "open", limit: 20 } } })),
    refetchInterval: 60_000,
  });
}

export function useInside() {
  return useQuery({
    queryKey: ["inside"],
    queryFn: () => unwrap(api.GET("/api/analytics/inside")),
    refetchInterval: 60_000,
  });
}

export function useVisits(status: "pending_approval" | "approved") {
  return useQuery({
    queryKey: ["visits", { status }],
    queryFn: () => unwrap(api.GET("/api/visits", { params: { query: { status, limit: 50 } } })),
    refetchInterval: 30_000,
  });
}

export function useArrivals() {
  return useQuery({
    queryKey: ["gate-events", { limit: 25 }],
    queryFn: () => unwrap(api.GET("/api/gate-events", { params: { query: { limit: 25 } } })),
    refetchInterval: 60_000, // real-time events do the work; this is a safety net
  });
}
