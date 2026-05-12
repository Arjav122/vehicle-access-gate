"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiV1 } from "@/config/api";
import { api } from "@/lib/api";
import { Check, X } from "lucide-react";

type Visitor = {
  id: string;
  name: string;
  phone: string;
  purpose: string;
  plate_raw: string;
  valid_until: string;
  expected_duration_minutes: number;
  status: string;
  created_at: string;
};

export default function ApprovalsPage() {
  const [rows, setRows] = useState<Visitor[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      setRows(await api<Visitor[]>(apiV1("/visitors/pending-approval")));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function decide(id: string, approved: boolean) {
    setErr(null);
    try {
      await api(apiV1(`/visitors/${id}/approval`), {
        method: "PATCH",
        body: JSON.stringify({ approved }),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <PageShell title="Gate pass approvals">
      <p className="mb-6 max-w-2xl text-sm text-slate-600">
        Pending visitor requests from the gate kiosk. Approving activates the pass window; rejecting closes the
        request.
      </p>
      {err && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
      <div className="space-y-4">
        {rows.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            No pending requests.
          </p>
        ) : (
          rows.map((v) => (
            <div
              key={v.id}
              className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between"
            >
              <div className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold text-slate-900">{v.name}</span>
                  <Badge variant="secondary">{v.status}</Badge>
                </div>
                <div className="text-slate-600">
                  <span className="font-medium text-slate-500">Plate:</span>{" "}
                  <span className="font-mono">{v.plate_raw}</span>
                </div>
                <div className="text-slate-600">
                  <span className="font-medium text-slate-500">Purpose:</span> {v.purpose}
                </div>
                <div className="text-xs text-slate-400">
                  Phone {v.phone} · up to {v.expected_duration_minutes} min · valid until{" "}
                  {new Date(v.valid_until).toLocaleString()}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => decide(v.id, true)}>
                  <Check className="mr-1 h-4 w-4" />
                  Approve
                </Button>
                <Button variant="destructive" onClick={() => decide(v.id, false)}>
                  <X className="mr-1 h-4 w-4" />
                  Reject
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </PageShell>
  );
}
