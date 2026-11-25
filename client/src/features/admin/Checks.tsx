// Admin "Checks": what the nightly reconciliation flagged (an exit with no entry, an entry
// never closed, a visit still inside a day past its limit). Mark each one resolved once looked at.
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ListChecks } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  ListSkeleton,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/features/shared/hooks";
import { PAGE_SIZE, Pager } from "@/features/shared/list";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const KIND: Record<Schemas["ReconciliationFlag"]["kind"], string> = {
  exit_without_entry: "Exit with no entry",
  entry_never_closed: "Entry never closed",
  stale_visit: "Visit open too long",
};

export default function Checks() {
  const [resolved, setResolved] = useState<"false" | "true">("false");
  const [offset, setOffset] = useState(0);
  const query = { resolved, limit: PAGE_SIZE, offset };
  const q = useQuery({
    queryKey: ["reconciliation", query],
    queryFn: () => unwrap(api.GET("/api/reconciliation", { params: { query } })),
    placeholderData: (prev) => prev,
  });
  const resolve = useAction(
    (id: string) =>
      unwrap(api.POST("/api/reconciliation/{id}/resolve", { params: { path: { id } } })),
    { success: "Marked resolved", invalidate: ["reconciliation"] },
  );
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Checks</h1>
        <p className="text-sm text-muted-foreground">
          Found by the nightly check at 03:00 IST. A resident car parked inside with one open entry
          is normal and not flagged.
        </p>
      </div>
      <Tabs
        value={resolved}
        onValueChange={(v) => {
          setResolved(v as "false" | "true");
          setOffset(0);
        }}
      >
        <TabsList>
          <TabsTrigger value="false">Open</TabsTrigger>
          <TabsTrigger value="true">Resolved</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card>
        <CardHeader title={resolved === "false" ? "Needs a look" : "Resolved"} />
        {q.isPending ? (
          <ListSkeleton rows={4} />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState
            icon={resolved === "false" ? <CheckCircle2 /> : <ListChecks />}
            title={resolved === "false" ? "Nothing to check" : "Nothing resolved yet"}
            {...(resolved === "false" ? { description: "Every entry and exit lines up." } : {})}
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {q.data.items.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <Badge tone={f.resolvedAt ? "neutral" : "warn"}>{KIND[f.kind]}</Badge>
                      <span className="text-xs text-muted-foreground">
                        flagged {formatDateTime(f.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm">{f.details}</p>
                  </div>
                  {f.resolvedAt ? (
                    <span className="text-xs text-muted-foreground">
                      resolved {formatDateTime(f.resolvedAt)}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      disabled={resolve.isPending}
                      onClick={() => {
                        resolve.mutate(f.id);
                      }}
                    >
                      Mark resolved
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <Pager offset={offset} total={q.data.total} onChange={setOffset} />
          </>
        )}
      </Card>
    </div>
  );
}
