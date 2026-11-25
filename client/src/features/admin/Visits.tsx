// Admin: every visit, filterable by status, category, flat / plate / name search and date.
// Phone numbers arrive masked from the server (privacy).
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, EmptyState, ErrorState, ListSkeleton } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { PlateChip } from "@/components/ui/PlateChip";
import { Table, Td, Th } from "@/components/ui/tabs";
import { PAGE_SIZE, Pager, SearchBox } from "@/features/shared/list";
import { useDebounced } from "@/features/shared/hooks";
import { VisitStatusBadge } from "@/features/shared/status";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api";
import { CATEGORY_LABEL, formatDateTime, formatMinutes, humanize, istDayBound } from "@/lib/format";

type Status = Schemas["Visit"]["status"];
type Category = Schemas["Visit"]["category"];
const STATUSES: Status[] = [
  "pending_approval",
  "approved",
  "denied",
  "expired",
  "inside",
  "overstayed",
  "escalated",
  "exited",
];

export default function Visits() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status | "">("");
  const [category, setCategory] = useState<Category | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const q = useDebounced(search.trim());
  const query = {
    limit: PAGE_SIZE,
    offset,
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(from ? { since: istDayBound(from) } : {}),
    ...(to ? { until: istDayBound(to, true) } : {}),
  };
  const visits = useQuery({
    queryKey: ["visits", query],
    queryFn: () => unwrap(api.GET("/api/visits", { params: { query } })),
    placeholderData: (prev) => prev,
  });
  const reset = () => {
    setOffset(0);
  };

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Visits</h1>
      <div className="flex flex-wrap gap-2">
        <SearchBox
          label="Search visits"
          placeholder="Flat, plate or visitor name"
          value={search}
          onChange={(v) => {
            setSearch(v);
            reset();
          }}
        />
        <Select
          aria-label="Status"
          className="w-48"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as Status | "");
            reset();
          }}
        >
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Category"
          className="w-40"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as Category | "");
            reset();
          }}
        >
          <option value="">Any category</option>
          {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          aria-label="From date"
          className="w-40"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            reset();
          }}
        />
        <Input
          type="date"
          aria-label="To date"
          className="w-40"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            reset();
          }}
        />
      </div>
      <Card>
        {visits.isPending ? (
          <ListSkeleton rows={8} />
        ) : visits.isError ? (
          <ErrorState message={errorMessage(visits.error)} onRetry={() => void visits.refetch()} />
        ) : visits.data.items.length === 0 ? (
          <EmptyState title="No visits match" description="Try clearing a filter." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Flat</Th>
                  <Th>Visitor</Th>
                  <Th>Plate</Th>
                  <Th>Category</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Stayed</Th>
                </tr>
              </thead>
              <tbody>
                {visits.data.items.map((v) => (
                  <tr key={v.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(v.createdAt)}</Td>
                    <Td className="font-medium">{v.flatLabel}</Td>
                    <Td>
                      <div>{v.visitor?.fullName ?? "Guest pass"}</div>
                      {v.visitor?.phone ? (
                        <div className="text-xs text-muted-foreground">{v.visitor.phone}</div>
                      ) : null}
                    </Td>
                    <Td>{v.plate ? <PlateChip plate={v.plate} size="sm" /> : "–"}</Td>
                    <Td>{CATEGORY_LABEL[v.category]}</Td>
                    <Td>
                      <VisitStatusBadge status={v.status} />
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {v.durationMinutes !== null ? formatMinutes(v.durationMinutes) : "–"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager offset={offset} total={visits.data.total} onChange={setOffset} />
          </>
        )}
      </Card>
    </div>
  );
}
