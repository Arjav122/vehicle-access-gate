// Resident: every visit to their flat(s), newest first, with paging.
import { useQuery } from "@tanstack/react-query";
import { History as HistoryIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, ErrorState, ListSkeleton } from "@/components/ui/card";
import { PlateChip } from "@/components/ui/PlateChip";
import { VisitStatusBadge } from "@/features/shared/status";
import { api, errorMessage, unwrap } from "@/lib/api";
import { CATEGORY_LABEL, formatDateTime, formatMinutes } from "@/lib/format";

const PAGE = 20;

export default function History() {
  const [offset, setOffset] = useState(0);
  const q = useQuery({
    queryKey: ["visits", { history: true, offset }],
    queryFn: () => unwrap(api.GET("/api/visits", { params: { query: { limit: PAGE, offset } } })),
    placeholderData: (prev) => prev,
  });
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Visit history</h1>
      <Card>
        {q.isPending ? (
          <ListSkeleton rows={6} />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState icon={<HistoryIcon />} title="No visits yet" />
        ) : (
          <ul className="divide-y divide-border">
            {q.data.items.map((v) => (
              <li key={v.id} className="grid gap-1.5 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{v.visitor?.fullName ?? "Guest pass visit"}</span>
                  <VisitStatusBadge status={v.status} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {v.plate ? <PlateChip plate={v.plate} size="sm" /> : <Badge>On foot</Badge>}
                  <span>
                    {CATEGORY_LABEL[v.category]}
                    {v.purpose ? ` · ${v.purpose}` : ""} · {formatDateTime(v.createdAt)}
                    {v.durationMinutes !== null
                      ? ` · stayed ${formatMinutes(v.durationMinutes)}`
                      : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {q.data && q.data.total > PAGE ? (
        <div className="flex items-center justify-between text-sm">
          <Button
            disabled={offset === 0}
            onClick={() => {
              setOffset(Math.max(0, offset - PAGE));
            }}
          >
            Newer
          </Button>
          <span className="text-muted-foreground">
            {offset + 1}–{Math.min(offset + PAGE, q.data.total)} of {q.data.total}
          </span>
          <Button
            disabled={offset + PAGE >= q.data.total}
            onClick={() => {
              setOffset(offset + PAGE);
            }}
          >
            Older
          </Button>
        </div>
      ) : null}
    </div>
  );
}
