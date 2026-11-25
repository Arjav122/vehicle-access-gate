// Column 1: live arrivals. Every camera read, newest first, with its snapshot, the plate and
// what the server decided, in words. A new car gets a "Register visitor" button.
import { ArrowDownLeft, ArrowUpRight, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, ErrorState, ListSkeleton } from "@/components/ui/card";
import { PlateChip } from "@/components/ui/PlateChip";
import { MatchBadge } from "@/features/shared/status";
import { useNow } from "@/features/shared/hooks";
import { Snapshot } from "@/features/shared/Snapshot";
import { useArrivals } from "./queries";
import { errorMessage } from "@/lib/api";
import { arrivalSentence, formatRelative, formatTime } from "@/lib/format";
import type { RegisterTarget } from "./RegisterVisitorDialog";

export function Arrivals({ onRegister }: { onRegister: (t: RegisterTarget) => void }) {
  const q = useArrivals();
  const now = useNow(30_000);
  return (
    <Card className="flex min-h-0 flex-col">
      <CardHeader title="Live arrivals" description="Camera reads at both gates, newest first" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {q.isPending ? (
          <ListSkeleton rows={5} />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState
            title="No cars yet"
            description="Reads from the gate cameras appear here the moment a car arrives."
          />
        ) : (
          <ul className="divide-y divide-border">
            {q.data.items.map((e) => {
              const canRegister =
                e.matchResult === "unknown" && e.direction === "entry" && !e.visitId;
              const Arrow = e.direction === "entry" ? ArrowDownLeft : ArrowUpRight;
              return (
                <li
                  key={e.id}
                  className={`flex gap-3 p-3 ${e.matchResult === "watchlist" ? "bg-danger-soft" : ""}`}
                >
                  <Snapshot eventId={e.id} hasSnapshot={e.hasSnapshot} className="h-16 w-24" />
                  <div className="grid min-w-0 flex-1 gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <PlateChip plate={e.plate} />
                      <MatchBadge result={e.matchResult} />
                    </div>
                    <p className="text-sm font-medium">{arrivalSentence(e)}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Arrow className="size-3" aria-hidden />
                      {e.gateName} {e.direction} · {formatTime(e.capturedAt)} (
                      {formatRelative(e.capturedAt, now)}) · OCR {Math.round(e.confidence * 100)}%
                    </p>
                  </div>
                  {canRegister ? (
                    <Button
                      variant="primary"
                      size="lg"
                      className="self-center"
                      onClick={() => {
                        onRegister({ plate: e.plate, gateEventId: e.id });
                      }}
                    >
                      <UserPlus aria-hidden />
                      <span className="hidden sm:inline">Register</span>
                      <span className="sr-only sm:hidden">Register visitor</span>
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
