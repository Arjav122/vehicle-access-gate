// Admin: the email delivery log (queued → sent, or failed after 5 attempts with the error).
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { useState } from "react";
import { Badge, Card, EmptyState, ErrorState, ListSkeleton } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { Table, Td, Th } from "@/components/ui/tabs";
import { PAGE_SIZE, Pager } from "@/features/shared/list";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api";
import { formatDateTime, humanize } from "@/lib/format";

type Status = Schemas["Notification"]["status"];

function StatusBadge({ n }: { n: Schemas["Notification"] }) {
  if (n.status === "sent")
    return (
      <Badge tone="ok">
        <CheckCircle2 /> Sent
      </Badge>
    );
  if (n.status === "failed")
    return (
      <Badge tone="danger">
        <XCircle /> Failed
      </Badge>
    );
  return (
    <Badge tone="info">
      <Clock /> Queued{n.attempts ? ` (try ${String(n.attempts + 1)})` : ""}
    </Badge>
  );
}

export default function Notifications() {
  const [status, setStatus] = useState<Status | "">("");
  const [offset, setOffset] = useState(0);
  const query = { limit: PAGE_SIZE, offset, ...(status ? { status } : {}) };
  const q = useQuery({
    queryKey: ["notifications", query],
    queryFn: () => unwrap(api.GET("/api/notifications", { params: { query } })),
    placeholderData: (prev) => prev,
  });
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Every email the system queued. Failed sends retry after 1, 2, 4 … 60 minutes.
          </p>
        </div>
        <Select
          aria-label="Status"
          className="w-40"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as Status | "");
            setOffset(0);
          }}
        >
          <option value="">Any status</option>
          <option value="pending">Queued</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </Select>
      </div>
      <Card>
        {q.isPending ? (
          <ListSkeleton rows={6} />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState
            title="No emails yet"
            description="Overstay emails and visit confirmations appear here."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Queued</Th>
                  <Th>Kind</Th>
                  <Th>To</Th>
                  <Th>Subject</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((n) => (
                  <tr key={n.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(n.createdAt)}</Td>
                    <Td>{humanize(n.kind)}</Td>
                    <Td>{n.recipient}</Td>
                    <Td className="max-w-sm">
                      <div className="truncate">{n.subject ?? "–"}</div>
                      {n.lastError ? (
                        <div className="truncate text-xs text-danger">{n.lastError}</div>
                      ) : null}
                    </Td>
                    <Td>
                      <StatusBadge n={n} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager offset={offset} total={q.data.total} onChange={setOffset} />
          </>
        )}
      </Card>
    </div>
  );
}
