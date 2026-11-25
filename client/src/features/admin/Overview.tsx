// Admin overview: headline numbers as stat tiles, then one chart per question, each a single
// series in the accent colour (title names it, no legend needed), with a tooltip and a
// "View as table" switch so no number is locked inside a picture.
//   busiest hours (entries per IST hour) · daily resident entries · daily visits · categories
// Two measures of different size (≈70 resident entries vs ≈13 visits a day) are two charts,
// never one chart with two y-axes.
import { useQuery } from "@tanstack/react-query";
import { Car, Clock, DoorOpen, TimerOff, Users } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { PlateChip } from "@/components/ui/PlateChip";
import { Table, Td, Th } from "@/components/ui/tabs";
import { useInside } from "@/features/guard/queries";
import { api, errorMessage, unwrap } from "@/lib/api";
import { CATEGORY_LABEL, formatDate, formatMinutes, formatRelative } from "@/lib/format";

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string | undefined;
}) {
  return (
    <Card className="grid gap-1 p-4">
      <span className="flex items-center gap-2 text-xs text-muted-foreground [&_svg]:size-4">
        {icon}
        {label}
      </span>
      <span className="text-2xl font-semibold">{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </Card>
  );
}

const hourLabel = (h: number) => {
  const suffix = h < 12 ? "am" : "pm";
  const n = h % 12 === 0 ? 12 : h % 12;
  return `${String(n)} ${suffix}`;
};

interface Row {
  label: string;
  value: number;
}

/** A bar chart card with a "View as table" switch. */
function ChartCard({
  title,
  description,
  rows,
  unit,
  valueLabel,
}: {
  title: string;
  description: string;
  rows: Row[];
  unit: string;
  valueLabel: string;
}) {
  const [table, setTable] = useState(false);
  const empty = rows.every((r) => r.value === 0);
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        action={
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={table}
            onClick={() => {
              setTable((t) => !t);
            }}
          >
            {table ? "View as chart" : "View as table"}
          </Button>
        }
      />
      {empty ? (
        <EmptyState title="No data in this period yet" />
      ) : table ? (
        <div className="max-h-72 overflow-y-auto">
          <Table>
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <Th>{valueLabel}</Th>
                <Th className="text-right">{unit}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <Td>{r.label}</Td>
                  <Td className="text-right">{r.value}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : (
        <div
          className="h-64 p-4"
          role="img"
          aria-label={`${title} chart. Use View as table for the numbers.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: 4, right: 4, bottom: 0, left: -16 }}
              barCategoryGap={2}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={12}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)" }}
                contentStyle={{
                  background: "var(--background)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--foreground)",
                  fontSize: 12,
                }}
                labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
                itemStyle={{ color: "var(--foreground)" }}
                formatter={(v) => [`${String(v)} ${unit}`, ""]}
                separator=""
              />
              <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

export default function Overview() {
  const [days, setDays] = useState(14);
  const q = useQuery({
    queryKey: ["analytics", { days }],
    queryFn: () => unwrap(api.GET("/api/analytics/overview", { params: { query: { days } } })),
    placeholderData: (prev) => prev,
  });
  const inside = useInside();

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="text-sm text-muted-foreground">Green Valley Residency · times in IST</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Period
          <Select
            className="w-36"
            value={String(days)}
            onChange={(e) => {
              setDays(Number(e.target.value));
            }}
          >
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
          </Select>
        </label>
      </div>

      {q.isError ? (
        <Card>
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        </Card>
      ) : !q.data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat
              icon={<Car />}
              label="Inside now"
              value={inside.data ? String(inside.data.total) : "–"}
              hint={
                inside.data
                  ? `${String(inside.data.residentVehicles)} resident · ${String(inside.data.visitors.length)} visitor`
                  : undefined
              }
            />
            <Stat
              icon={<DoorOpen />}
              label="Resident entries"
              value={q.data.totals.residentEntries.toLocaleString("en-IN")}
              hint={`${String(q.data.totals.gateEvents)} camera reads in all`}
            />
            <Stat
              icon={<Users />}
              label="Visits"
              value={q.data.totals.visits.toLocaleString("en-IN")}
              hint={`${String(q.data.totals.completedVisits)} completed`}
            />
            <Stat
              icon={<Clock />}
              label="Average visit"
              value={
                q.data.averageVisitMinutes === null
                  ? "–"
                  : formatMinutes(q.data.averageVisitMinutes)
              }
              hint="Completed visits"
            />
            <Stat
              icon={<TimerOff />}
              label="Overstay rate"
              value={
                q.data.overstayRate === null ? "–" : `${(q.data.overstayRate * 100).toFixed(1)}%`
              }
              hint="Visitors past their time limit"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Busiest hours"
              description="Cars arriving per hour of the day (all entry lanes)"
              unit="entries"
              valueLabel="Hour"
              rows={q.data.busiestHours.map((h) => ({
                label: hourLabel(h.hour),
                value: h.entries,
              }))}
            />
            <ChartCard
              title="Visits per day"
              description="Visitors registered or admitted with a guest pass"
              unit="visits"
              valueLabel="Day"
              rows={q.data.daily.map((d) => ({
                label: formatDate(`${d.date}T12:00:00+05:30`),
                value: d.visits,
              }))}
            />
            <ChartCard
              title="Resident entries per day"
              description="Resident cars read at an entry camera"
              unit="entries"
              valueLabel="Day"
              rows={q.data.daily.map((d) => ({
                label: formatDate(`${d.date}T12:00:00+05:30`),
                value: d.residentEntries,
              }))}
            />
            <ChartCard
              title="Visits by category"
              description="Each category has its own time limit"
              unit="visits"
              valueLabel="Category"
              rows={q.data.byCategory.map((c) => ({
                label: CATEGORY_LABEL[c.category] ?? c.category,
                value: c.visits,
              }))}
            />
          </div>

          <Card>
            <CardHeader title="Frequent visitors" description="Plates seen on two or more visits" />
            {q.data.frequentVisitors.length === 0 ? (
              <EmptyState title="No repeat visitors in this period" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Plate</Th>
                    <Th>Flat (last visit)</Th>
                    <Th className="text-right">Visits</Th>
                    <Th>Last seen</Th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.frequentVisitors.map((f) => (
                    <tr key={f.plate}>
                      <Td>
                        <PlateChip plate={f.plate} size="sm" />
                      </Td>
                      <Td>{f.flatLabel}</Td>
                      <Td className="text-right">{f.visits}</Td>
                      <Td className="text-muted-foreground">{formatRelative(f.lastVisitAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
