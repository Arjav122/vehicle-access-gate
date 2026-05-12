"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiV1 } from "@/config/api";
import { api } from "@/lib/api";

type LogRow = {
  id: string;
  plate_normalized: string;
  user_type: string;
  user_name: string;
  access_result: string;
  created_at: string;
};

export default function LogsPage() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [plate, setPlate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function fetchLogs(filter?: string) {
    const q = filter ? `?plate=${encodeURIComponent(filter)}` : "";
    setRows(await api<LogRow[]>(`${apiV1("/logs/access")}${q}`));
  }

  useEffect(() => {
    fetchLogs().catch(console.error);
  }, []);

  async function removeLog(id: string) {
    if (!window.confirm("Delete this log entry?")) return;
    setError(null);
    try {
      await api(apiV1(`/logs/access/${id}`), { method: "DELETE" });
      await fetchLogs(plate || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <PageShell title="Access logs">
      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="mb-4 flex gap-2">
        <Input placeholder="Filter plate" value={plate} onChange={(e) => setPlate(e.target.value)} className="max-w-xs" />
        <button
          type="button"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
          onClick={() => fetchLogs(plate || undefined)}
        >
          Search
        </button>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Plate</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Access Result</TableHead>
              <TableHead>User Type</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs text-slate-600">{new Date(r.created_at).toLocaleString()}</TableCell>
                <TableCell className="font-mono">{r.plate_normalized}</TableCell>
                <TableCell>{r.user_name}</TableCell>
                <TableCell>{r.access_result}</TableCell>
                <TableCell className="text-xs">{r.user_type}</TableCell>
                <TableCell className="text-right">
                  <Button variant="destructive" size="sm" onClick={() => removeLog(r.id)}>
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
