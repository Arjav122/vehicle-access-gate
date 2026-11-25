// Column 3: what needs the guard. Watchlist alerts (red, first), unclear plates to check, and
// "call the resident" tasks for visitors an hour past their limit (full phone, tap to dial).
import { Check, Phone, PhoneOff, ShieldAlert, X } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  ListSkeleton,
} from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { PlateChip } from "@/components/ui/PlateChip";
import { useAction, useNow } from "@/features/shared/hooks";
import { Snapshot } from "@/features/shared/Snapshot";
import { useCallTasks, useOpenAlerts, useReviewQueue } from "./queries";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api";
import { CATEGORY_LABEL, formatRelative, formatTime, formatPhone } from "@/lib/format";

function Alerts({ now }: { now: Date }) {
  const q = useOpenAlerts();
  const ack = useAction(
    (id: string) => unwrap(api.POST("/api/alerts/{id}/acknowledge", { params: { path: { id } } })),
    { success: "Alert acknowledged", invalidate: ["alerts"] },
  );
  if (q.isPending) return <ListSkeleton rows={1} />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  if (q.data.items.length === 0) return null;
  return (
    <Card className="border-danger">
      <CardHeader
        className="bg-danger-soft"
        title={
          <span className="flex items-center gap-2 text-danger">
            <ShieldAlert className="size-4" aria-hidden /> Watchlist alerts
          </span>
        }
        description="Stop the car and check before opening the barrier"
      />
      <ul className="divide-y divide-border">
        {q.data.items.map((a) => (
          <li key={a.id} className="grid gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <PlateChip plate={a.plate} />
              <Badge tone="danger">{a.severity === "critical" ? "Critical" : "Warning"}</Badge>
              <span className="text-xs text-muted-foreground">
                {formatTime(a.createdAt)} ({formatRelative(a.createdAt, now)})
              </span>
            </div>
            <p className="text-sm">{a.message}</p>
            <Button
              size="lg"
              disabled={ack.isPending}
              onClick={() => {
                ack.mutate(a.id);
              }}
            >
              <Check aria-hidden /> Acknowledge
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReviewItem({ e }: { e: Schemas["GateEvent"] }) {
  const [plate, setPlate] = useState("");
  const review = useAction(
    (body: { action: "dismiss" } | { action: "correct"; plate: string }) =>
      unwrap(api.POST("/api/gate-events/{id}/review", { params: { path: { id: e.id } }, body })),
    {
      success: (r) => (r.reviewedAt && r.matchResult !== "low_confidence" ? "Plate saved" : "Done"),
      invalidate: ["review-queue", "gate-events", "visits", "inside"],
    },
  );
  const submit = (ev: SubmitEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (plate.trim()) review.mutate({ action: "correct", plate: plate.trim() });
  };
  return (
    <li className="grid gap-2 p-3">
      <div className="flex gap-3">
        <Snapshot eventId={e.id} hasSnapshot={e.hasSnapshot} className="h-16 w-24" />
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <PlateChip plate={e.plate} size="sm" />
            <span className="text-xs text-muted-foreground">
              OCR {Math.round(e.confidence * 100)}% · {e.gateName} {e.direction}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {e.reviewReason ?? "Unclear read"} · {formatTime(e.capturedAt)}
          </p>
        </div>
      </div>
      <form className="flex gap-2" onSubmit={submit}>
        <Input
          aria-label={`Correct plate for read at ${formatTime(e.capturedAt)}`}
          placeholder="Type the plate you see"
          autoCapitalize="characters"
          value={plate}
          className="h-11"
          onChange={(ev) => {
            setPlate(ev.target.value.toUpperCase());
          }}
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={!plate.trim() || review.isPending}
        >
          Save
        </Button>
        <Button
          type="button"
          size="lg"
          aria-label="Dismiss: not a car"
          disabled={review.isPending}
          onClick={() => {
            review.mutate({ action: "dismiss" });
          }}
        >
          <X aria-hidden />
        </Button>
      </form>
    </li>
  );
}

function ReviewQueue() {
  const q = useReviewQueue();
  return (
    <Card>
      <CardHeader
        title="Check these plates"
        description="The camera wasn't sure. Your correction also trains the next model."
      />
      {q.isPending ? (
        <ListSkeleton rows={1} />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} />
      ) : q.data.items.length === 0 ? (
        <EmptyState title="All plates checked" />
      ) : (
        <ul className="divide-y divide-border">
          {q.data.items.map((e) => (
            <ReviewItem key={e.id} e={e} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function CallTask({ t, now }: { t: Schemas["EscalationTask"]; now: Date }) {
  const resolve = useAction(
    (outcome: "reached" | "not_reached") =>
      unwrap(
        api.POST("/api/escalations/{id}/resolve", {
          params: { path: { id: t.id } },
          body: { outcome },
        }),
      ),
    { success: "Call recorded", invalidate: ["escalations"] },
  );
  return (
    <li className="grid gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {t.visit.plate ? <PlateChip plate={t.visit.plate} size="sm" /> : null}
        <span className="font-semibold">{t.visit.flatLabel}</span>
        <Badge tone="danger">{CATEGORY_LABEL[t.visit.category] ?? t.visit.category}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {t.visit.visitorName ?? "Visitor"}
        {t.visit.expectedExitAt
          ? ` · limit passed ${formatRelative(t.visit.expectedExitAt, now)}`
          : ""}
      </p>
      <ul className="grid gap-1.5">
        {t.residents.map((r) =>
          r.phone ? (
            <li key={r.phone}>
              <Button asChild size="lg" className="w-full justify-start">
                <a href={`tel:${r.phone}`}>
                  <Phone aria-hidden />
                  Call {r.fullName}
                  {r.isPrimaryContact ? " (primary)" : ""} · {formatPhone(r.phone)}
                </a>
              </Button>
            </li>
          ) : null,
        )}
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="ok"
          disabled={resolve.isPending}
          onClick={() => {
            resolve.mutate("reached");
          }}
        >
          <Check aria-hidden /> Reached
        </Button>
        <Button
          disabled={resolve.isPending}
          onClick={() => {
            resolve.mutate("not_reached");
          }}
        >
          <PhoneOff aria-hidden /> No answer
        </Button>
      </div>
    </li>
  );
}

function CallTasks({ now }: { now: Date }) {
  const q = useCallTasks();
  return (
    <Card>
      <CardHeader title="Call the resident" description="Visitors an hour past their time limit" />
      {q.isPending ? (
        <ListSkeleton rows={1} />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} />
      ) : q.data.items.length === 0 ? (
        <EmptyState title="No calls to make" />
      ) : (
        <ul className="divide-y divide-border">
          {q.data.items.map((t) => (
            <CallTask key={t.id} t={t} now={now} />
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Attention() {
  const now = useNow(30_000);
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      <Alerts now={now} />
      <CallTasks now={now} />
      <ReviewQueue />
    </div>
  );
}
