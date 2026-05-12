"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { apiV1 } from "@/config/api";
import { api } from "@/lib/api";

type AlertRow = {
  id: string;
  alert_type: string;
  title: string;
  message: string;
  severity: string;
  resolved: boolean;
  created_at: string;
};

export default function AlertsPage() {
  const [rows, setRows] = useState<AlertRow[]>([]);

  async function load() {
    setRows(await api<AlertRow[]>(`${apiV1("/alerts")}?resolved=false`));
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function resolve(id: string) {
    await api(apiV1(`/alerts/${id}`), { method: "PATCH", body: JSON.stringify({ resolved: true }) });
    await load();
  }

  return (
    <PageShell title="Alerts">
      <div className="rounded-xl border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>When</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-xs">{a.alert_type}</TableCell>
                <TableCell>
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-slate-500">{a.message}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={a.severity === "high" || a.severity === "critical" ? "destructive" : "secondary"}>
                    {a.severity}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">{new Date(a.created_at).toLocaleString()}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => resolve(a.id)}>
                    Resolve
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
