"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiV1 } from "@/config/api";
import { api } from "@/lib/api";

type Setting = { id: string; key: string; value: string; updated_at: string };

export default function SettingsPage() {
  const [rows, setRows] = useState<Setting[]>([]);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  async function load() {
    setRows(await api<Setting[]>(apiV1("/settings")));
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await api(apiV1("/settings"), { method: "PUT", body: JSON.stringify({ key, value }) });
    setKey("");
    setValue("");
    await load();
  }

  return (
    <PageShell title="Settings">
      <form onSubmit={save} className="mb-8 flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <Label>Key</Label>
          <Input className="mt-1 w-48" value={key} onChange={(e) => setKey(e.target.value)} required />
        </div>
        <div>
          <Label>Value</Label>
          <Input className="mt-1 w-96" value={value} onChange={(e) => setValue(e.target.value)} required />
        </div>
        <Button type="submit">Save</Button>
      </form>
      <div className="rounded-xl border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-mono text-xs">{s.key}</TableCell>
                <TableCell className="max-w-md truncate">{s.value}</TableCell>
                <TableCell className="text-xs text-slate-500">{new Date(s.updated_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PageShell>
  );
}
