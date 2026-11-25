// Admin: who changed what (read-only). Changes show as "colour: White → Grey".
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, EmptyState, ErrorState, ListSkeleton } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/tabs";
import { PAGE_SIZE, Pager } from "@/features/shared/list";
import { api, errorMessage, unwrap } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

const show = (v: unknown) =>
  v === null || v === undefined ? "–" : typeof v === "string" ? v : JSON.stringify(v);

/** {"colour": ["White","Grey"]} → ["colour: White → Grey"] */
function changeLines(changes: unknown): string[] {
  if (!changes || typeof changes !== "object") return [];
  return Object.entries(changes as Record<string, unknown>).map(([field, value]) =>
    Array.isArray(value) && value.length === 2
      ? `${field}: ${show(value[0])} → ${show(value[1])}`
      : `${field}: ${show(value)}`,
  );
}

export default function AuditLog() {
  const [offset, setOffset] = useState(0);
  const query = { limit: PAGE_SIZE, offset };
  const q = useQuery({
    queryKey: ["audit-logs", query],
    queryFn: () => unwrap(api.GET("/api/audit-logs", { params: { query } })),
    placeholderData: (prev) => prev,
  });
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every create, update and delete by an admin. Passwords are never recorded.
        </p>
      </div>
      <Card>
        {q.isPending ? (
          <ListSkeleton rows={6} />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState title="No admin changes yet" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>Action</Th>
                  <Th>Changes</Th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((a) => {
                  const actor = a.actor as { fullName?: string } | null;
                  return (
                    <tr key={a.id}>
                      <Td className="whitespace-nowrap">{formatDateTime(a.createdAt)}</Td>
                      <Td>{actor?.fullName ?? "System"}</Td>
                      <Td className="font-mono text-xs">{a.action}</Td>
                      <Td className="text-xs">
                        {changeLines(a.changes).map((line) => (
                          <div key={line}>{line}</div>
                        ))}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pager offset={offset} total={q.data.total} onChange={setOffset} />
          </>
        )}
      </Card>
    </div>
  );
}
