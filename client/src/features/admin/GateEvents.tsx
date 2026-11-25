// Admin: every camera read, filterable, with a CSV export of what the filters match.
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, ErrorState, ListSkeleton } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { PlateChip } from "@/components/ui/PlateChip";
import { Table, Td, Th } from "@/components/ui/tabs";
import { Snapshot } from "@/features/shared/Snapshot";
import { PAGE_SIZE, Pager, SearchBox } from "@/features/shared/list";
import { useDebounced } from "@/features/shared/hooks";
import { MatchBadge } from "@/features/shared/status";
import { api, downloadFile, errorMessage, unwrap, type Schemas } from "@/lib/api";
import { arrivalSentence, formatDateTime, humanize, istDayBound } from "@/lib/format";

type Match = Schemas["GateEvent"]["matchResult"];
const MATCHES: Match[] = [
  "resident",
  "visitor",
  "guest_pass",
  "watchlist",
  "low_confidence",
  "ambiguous",
  "unknown",
];

export default function GateEvents() {
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"entry" | "exit" | "">("");
  const [match, setMatch] = useState<Match | "">("");
  const [review, setReview] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const q = useDebounced(search.trim());
  const filters = {
    ...(q ? { q } : {}),
    ...(direction ? { direction } : {}),
    ...(match ? { matchResult: match } : {}),
    ...(review ? { needsReview: "true" as const } : {}),
    ...(from ? { since: istDayBound(from) } : {}),
    ...(to ? { until: istDayBound(to, true) } : {}),
  };
  const query = { ...filters, limit: PAGE_SIZE, offset };
  const events = useQuery({
    queryKey: ["gate-events", query],
    queryFn: () => unwrap(api.GET("/api/gate-events", { params: { query } })),
    placeholderData: (prev) => prev,
  });
  const reset = () => {
    setOffset(0);
  };

  const exportCsv = () => {
    const params = new URLSearchParams({ ...filters, format: "csv" });
    downloadFile(`/api/gate-events?${params.toString()}`, "gate-events.csv").catch(
      (err: unknown) => {
        toast.error(errorMessage(err));
      },
    );
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Gate events</h1>
        <Button onClick={exportCsv}>
          <Download aria-hidden /> Export CSV
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <SearchBox
          label="Search plates"
          placeholder="Plate, e.g. UP16"
          value={search}
          onChange={(v) => {
            setSearch(v);
            reset();
          }}
        />
        <Select
          aria-label="Lane"
          className="w-32"
          value={direction}
          onChange={(e) => {
            setDirection(e.target.value as "entry" | "exit" | "");
            reset();
          }}
        >
          <option value="">Both lanes</option>
          <option value="entry">Entry</option>
          <option value="exit">Exit</option>
        </Select>
        <Select
          aria-label="Result"
          className="w-44"
          value={match}
          onChange={(e) => {
            setMatch(e.target.value as Match | "");
            reset();
          }}
        >
          <option value="">Any result</option>
          {MATCHES.map((m) => (
            <option key={m} value={m}>
              {humanize(m)}
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
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={review}
            onChange={(e) => {
              setReview(e.target.checked);
              reset();
            }}
          />
          Needs review only
        </label>
      </div>
      <Card>
        {events.isPending ? (
          <ListSkeleton rows={8} />
        ) : events.isError ? (
          <ErrorState message={errorMessage(events.error)} onRetry={() => void events.refetch()} />
        ) : events.data.items.length === 0 ? (
          <EmptyState title="No camera reads match" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Snapshot</Th>
                  <Th>Plate</Th>
                  <Th>Result</Th>
                  <Th>What happened</Th>
                  <Th>Gate</Th>
                  <Th>Captured</Th>
                  <Th className="text-right">OCR</Th>
                </tr>
              </thead>
              <tbody>
                {events.data.items.map((e) => (
                  <tr key={e.id}>
                    <Td>
                      <Snapshot eventId={e.id} hasSnapshot={e.hasSnapshot} className="h-10 w-16" />
                    </Td>
                    <Td>
                      <div className="grid gap-1">
                        <PlateChip plate={e.plate} size="sm" />
                        {e.ocrFixes > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            read “{e.plateRaw}”, {e.ocrFixes} fixed
                          </span>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      <MatchBadge result={e.matchResult} />
                      {e.needsReview ? (
                        <Badge tone="warn" className="ml-1">
                          Review
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="text-sm">{arrivalSentence(e)}</Td>
                    <Td className="whitespace-nowrap">
                      {e.gateName} · {e.direction}
                    </Td>
                    <Td className="whitespace-nowrap">{formatDateTime(e.capturedAt)}</Td>
                    <Td className="text-right">{Math.round(e.confidence * 100)}%</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager offset={offset} total={events.data.total} onChange={setOffset} />
          </>
        )}
      </Card>
    </div>
  );
}
