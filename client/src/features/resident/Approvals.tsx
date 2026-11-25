// Resident: a visitor is at the gate. Full-width Approve / Deny with a visible countdown;
// after 3 minutes the guard decides. The same answer twice is fine; a different second
// answer (another family member got there first) is refused and the screen refreshes.
import { useQuery } from "@tanstack/react-query";
import { BellRing, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  ListSkeleton,
} from "@/components/ui/card";
import { PlateChip } from "@/components/ui/PlateChip";
import { useAction, useNow } from "@/features/shared/hooks";
import { VisitStatusBadge } from "@/features/shared/status";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api";
import { CATEGORY_LABEL, formatCountdown, formatRelative, formatTime } from "@/lib/format";

type Visit = Schemas["Visit"];

function usePending() {
  return useQuery({
    queryKey: ["approvals", { status: "pending" }],
    queryFn: () =>
      unwrap(api.GET("/api/approvals", { params: { query: { status: "pending", limit: 20 } } })),
    refetchInterval: 30_000,
  });
}

function useRecent() {
  return useQuery({
    queryKey: ["approvals", { recent: true }],
    queryFn: () => unwrap(api.GET("/api/approvals", { params: { query: { limit: 8 } } })),
  });
}

function PendingApproval({ v, now }: { v: Visit; now: Date }) {
  const approvalId = v.approval?.id ?? "";
  const decide = useAction(
    (decision: "approve" | "deny") =>
      unwrap(
        api.POST("/api/approvals/{id}/decision", {
          params: { path: { id: approvalId } },
          body: { decision },
        }),
      ),
    {
      success: (r) =>
        r.status === "denied"
          ? "Denied. The guard will turn them away."
          : "Approved. The guard will let them in.",
      invalidate: ["approvals", "visits"],
    },
  );
  const expiresAt = v.approval ? new Date(v.approval.expiresAt) : now;
  const total = 180;
  const left = Math.max(0, (expiresAt.getTime() - now.getTime()) / 1000);
  const timedOut = left <= 0;
  return (
    <Card className="grid gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-lg font-semibold">{v.visitor?.fullName ?? "A visitor"}</p>
          <p className="text-sm text-muted-foreground">
            {CATEGORY_LABEL[v.category]}
            {v.purpose ? ` · ${v.purpose}` : ""} · for {v.flatLabel}
          </p>
          <p className="text-xs text-muted-foreground">
            At the gate since {formatTime(v.createdAt)}
          </p>
        </div>
        {v.plate ? <PlateChip plate={v.plate} /> : <Badge>On foot</Badge>}
      </div>
      {timedOut ? (
        <p className="text-sm font-medium text-warn">
          Time is up. The guard at the gate is deciding now.
        </p>
      ) : (
        <>
          <div className="grid gap-1.5" aria-live="polite">
            <div className="flex justify-between text-sm">
              <span>Answer within</span>
              <span className="font-semibold">{formatCountdown(left)}</span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Time left to answer"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={Math.round(left)}
            >
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${String(Math.min(100, (left / total) * 100))}%` }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="ok"
              size="lg"
              className="h-14 text-base"
              disabled={decide.isPending}
              onClick={() => {
                decide.mutate("approve");
              }}
            >
              <Check aria-hidden /> Approve
            </Button>
            <Button
              variant="danger"
              size="lg"
              className="h-14 text-base"
              disabled={decide.isPending}
              onClick={() => {
                decide.mutate("deny");
              }}
            >
              <X aria-hidden /> Deny
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

export default function Approvals() {
  const pending = usePending();
  const recent = useRecent();
  const now = useNow(1000);
  const decided = recent.data?.items.filter((v) => v.status !== "pending_approval") ?? [];
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Approvals</h1>
      {pending.isPending ? (
        <ListSkeleton rows={2} />
      ) : pending.isError ? (
        <ErrorState message={errorMessage(pending.error)} onRetry={() => void pending.refetch()} />
      ) : pending.data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BellRing />}
            title="Nobody is waiting at the gate"
            description="When the guard registers a visitor for your flat, you'll get Approve / Deny right here."
          />
        </Card>
      ) : (
        pending.data.items.map((v) => <PendingApproval key={v.id} v={v} now={now} />)
      )}

      <Card>
        <CardHeader title="Recent answers" />
        {recent.isPending ? (
          <ListSkeleton rows={2} />
        ) : decided.length === 0 ? (
          <EmptyState title="No answers yet" />
        ) : (
          <ul className="divide-y divide-border">
            {decided.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{v.visitor?.fullName ?? "Visitor"}</p>
                  <p className="text-xs text-muted-foreground">
                    {CATEGORY_LABEL[v.category]} · {formatRelative(v.createdAt, now)}
                  </p>
                </div>
                <VisitStatusBadge status={v.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
