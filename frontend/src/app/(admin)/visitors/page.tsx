"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { apiV1 } from "@/config/api";
import { api } from "@/lib/api";

function statusLabel(status: string): string {
  if (status === "valid") return "VALID";
  if (status === "pending") return "PENDING";
  return status.toUpperCase();
}

type Visitor = {
  id: string;
  name: string;
  phone: string;
  plate_raw: string;
  status: string;
  valid_until: string;
  entered_at?: string | null;
  exited_at?: string | null;
};

/** Same rules as backend `active_pass_not_expired` (avoids rewrite/query issues on `/api/*`). */
function matchesActivePassFilter(v: Visitor): boolean {
  const nowMs = Date.now();
  const untilMs = new Date(v.valid_until).getTime();
  const st = v.status.toLowerCase();

  if (st === "overstayed") {
    return v.exited_at == null || v.exited_at === "";
  }
  if (st === "valid" || st === "entered") {
    return Number.isFinite(untilMs) && untilMs >= nowMs;
  }
  return false;
}

export default function VisitorsPage() {
  const [allRows, setAllRows] = useState<Visitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePassOnly, setActivePassOnly] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<Visitor[]>(apiV1("/visitors"));
      setAllRows(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load visitors");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll().catch(console.error);
  }, [loadAll]);

  const displayRows = useMemo(
    () => (activePassOnly ? allRows.filter(matchesActivePassFilter) : allRows),
    [allRows, activePassOnly],
  );

  async function removeVisitor(id: string) {
    if (!window.confirm("Delete this visitor record?")) return;
    setError(null);
    try {
      await api(apiV1(`/visitors/${id}`), { method: "DELETE" });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <PageShell title="Visitors">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant={activePassOnly ? "default" : "outline"}
          onClick={() => setActivePassOnly((prev) => !prev)}
        >
          {activePassOnly ? "Showing active passes only" : "Show active passes only"}
        </Button>
        <p className="text-sm text-slate-600">
          Full list loads from the server; the button filters here for passes still within{" "}
          <span className="font-medium">valid until</span> (or on-site overstayed, not exited yet).
        </p>
      </div>
      {loading && <p className="mb-2 text-sm text-slate-500">Loading…</p>}
      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="rounded-xl border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Plate</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Valid until</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && displayRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-slate-500">
                  {activePassOnly
                    ? "No visitors match an active (non-expired) pass. Turn the filter off to see everyone."
                    : "No visitor records yet."}
                </TableCell>
              </TableRow>
            )}
            {displayRows.map((v) => (
              <TableRow key={v.id}>
                <TableCell>{v.name}</TableCell>
                <TableCell>{v.phone}</TableCell>
                <TableCell className="font-mono">{v.plate_raw}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      v.status === "valid"
                        ? "default"
                        : v.status === "pending"
                          ? "outline"
                          : "secondary"
                    }
                  >
                    {statusLabel(v.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-slate-600">{new Date(v.valid_until).toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <Button variant="destructive" size="sm" onClick={() => removeVisitor(v.id)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PageShell>
  );
}
