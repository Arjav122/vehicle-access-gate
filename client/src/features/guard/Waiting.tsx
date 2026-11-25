// Column 2: visitors waiting for a decision (resident countdown → then the guard decides),
// approved visitors not yet inside (manual "Let in"), and who is inside (manual "Exit").
import { Check, DoorOpen, LogOut, X } from "lucide-react";
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
import { useInside, useVisits } from "./queries";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api";
import { CATEGORY_LABEL, formatCountdown, formatRelative, formatTime } from "@/lib/format";

type Visit = Schemas["Visit"];
const AFTER_DECISION = ["visits", "approvals", "inside", "gate-events"];

function VisitLine({ v }: { v: Visit }) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {v.plate ? <PlateChip plate={v.plate} /> : <Badge>On foot</Badge>}
        <span className="font-semibold">{v.flatLabel}</span>
        <Badge>{CATEGORY_LABEL[v.category]}</Badge>
      </div>
      <p className="truncate text-sm text-muted-foreground">
        {v.visitor?.fullName ?? "Visitor"}
        {v.purpose ? ` · ${v.purpose}` : ""}
      </p>
    </div>
  );
}

function PendingCard({ v, now }: { v: Visit; now: Date }) {
  const decide = useAction(
    (decision: "approve" | "deny") =>
      unwrap(
        api.POST("/api/visits/{id}/decision", {
          params: { path: { id: v.id } },
          body: { decision },
        }),
      ),
    {
      success: (r) => (r.status === "denied" ? "Visitor denied" : "Visitor approved"),
      invalidate: AFTER_DECISION,
    },
  );
  const expiresAt = v.approval ? new Date(v.approval.expiresAt) : null;
  const secondsLeft = expiresAt ? (expiresAt.getTime() - now.getTime()) / 1000 : 0;
  const guardDecides = secondsLeft <= 0;
  return (
    <li className="grid gap-3 p-3">
      <VisitLine v={v} />
      {guardDecides ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium text-warn">No answer from the flat. You decide now.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="ok"
              size="lg"
              disabled={decide.isPending}
              onClick={() => {
                decide.mutate("approve");
              }}
            >
              <Check aria-hidden /> Let in
            </Button>
            <Button
              variant="danger"
              size="lg"
              disabled={decide.isPending}
              onClick={() => {
                decide.mutate("deny");
              }}
            >
              <X aria-hidden /> Turn away
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Asking the residents ·{" "}
          <span className="font-semibold text-foreground">{formatCountdown(secondsLeft)}</span> left
        </p>
      )}
    </li>
  );
}

function ApprovedCard({ v }: { v: Visit }) {
  const enter = useAction(
    () => unwrap(api.POST("/api/visits/{id}/enter", { params: { path: { id: v.id } } })),
    { success: "Entry logged", invalidate: AFTER_DECISION },
  );
  return (
    <li className="flex items-center justify-between gap-3 p-3">
      <VisitLine v={v} />
      <Button
        size="lg"
        disabled={enter.isPending}
        onClick={() => {
          enter.mutate(undefined);
        }}
      >
        <DoorOpen aria-hidden /> Let in
      </Button>
    </li>
  );
}

function InsideList({ now }: { now: Date }) {
  const q = useInside();
  if (q.isPending) return <ListSkeleton rows={2} />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  if (q.data.visitors.length === 0)
    return <EmptyState title="No visitors inside" description="Resident cars are not listed." />;
  return (
    <ul className="divide-y divide-border">
      {q.data.visitors.map((v) => (
        <InsideRow key={v.visitId} v={v} now={now} />
      ))}
    </ul>
  );
}

function InsideRow({ v, now }: { v: Schemas["VehiclesInside"]["visitors"][number]; now: Date }) {
  const exit = useAction(
    () => unwrap(api.POST("/api/visits/{id}/exit", { params: { path: { id: v.visitId } } })),
    { success: "Exit logged", invalidate: AFTER_DECISION },
  );
  const late = v.expectedExitAt !== null && new Date(v.expectedExitAt) < now;
  return (
    <li className="flex items-center justify-between gap-3 p-3">
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {v.plate ? <PlateChip plate={v.plate} size="sm" /> : null}
          <span className="text-sm font-semibold">{v.flatLabel}</span>
          <VisitStatusBadge status={v.status as Visit["status"]} />
        </div>
        <p className="text-xs text-muted-foreground">
          {v.visitorName ?? "Visitor"} · {CATEGORY_LABEL[v.category] ?? v.category}
          {v.enteredAt ? ` · in at ${formatTime(v.enteredAt)}` : ""}
          {v.expectedExitAt
            ? late
              ? ` · limit passed ${formatRelative(v.expectedExitAt, now)}`
              : ` · due out ${formatTime(v.expectedExitAt)}`
            : ""}
        </p>
      </div>
      <Button
        size="sm"
        disabled={exit.isPending}
        onClick={() => {
          exit.mutate(undefined);
        }}
      >
        <LogOut aria-hidden /> Exit
      </Button>
    </li>
  );
}

export function Waiting() {
  const pending = useVisits("pending_approval");
  const approved = useVisits("approved");
  const now = useNow(1000);
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Card className="flex min-h-0 flex-col">
        <CardHeader
          title="Waiting for a decision"
          description="Residents have 3 minutes to answer, then you decide"
        />
        <div className="min-h-0 overflow-y-auto">
          {pending.isPending ? (
            <ListSkeleton rows={2} />
          ) : pending.isError ? (
            <ErrorState
              message={errorMessage(pending.error)}
              onRetry={() => void pending.refetch()}
            />
          ) : pending.data.items.length === 0 && approved.data?.items.length === 0 ? (
            <EmptyState title="Nobody waiting" description="Registered visitors show up here." />
          ) : (
            <ul className="divide-y divide-border">
              {pending.data.items.map((v) => (
                <PendingCard key={v.id} v={v} now={now} />
              ))}
              {approved.data?.items.map((v) => (
                <ApprovedCard key={v.id} v={v} />
              ))}
            </ul>
          )}
        </div>
      </Card>
      <Card className="flex min-h-0 flex-col">
        <CardHeader title="Visitors inside" description="Exit is logged by the camera, or here" />
        <div className="min-h-0 overflow-y-auto">
          <InsideList now={now} />
        </div>
      </Card>
    </div>
  );
}
