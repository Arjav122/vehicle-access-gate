"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiV1 } from "@/config/api";
import { api } from "@/lib/api";

export default function ReportsPage() {
  const [data, setData] = useState<{ period_days: number; entries: number; exits: number } | null>(null);

  useEffect(() => {
    api<{ period_days: number; entries: number; exits: number }>(apiV1("/reports/weekly-traffic"))
      .then(setData)
      .catch(console.error);
  }, []);

  return (
    <PageShell title="Reports">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Weekly traffic</CardTitle>
        </CardHeader>
        <CardContent>
          {data ? (
            <ul className="space-y-2 text-sm">
              <li>
                Period: <strong>{data.period_days}</strong> days
              </li>
              <li>
                Entries: <strong>{data.entries}</strong>
              </li>
              <li>
                Exits: <strong>{data.exits}</strong>
              </li>
            </ul>
          ) : (
            <p className="text-slate-600">Loading…</p>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
