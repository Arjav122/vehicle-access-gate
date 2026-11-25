// Analytics for the admin dashboard and the guards' "vehicles inside" counter.
// Read-only SQL over gate_events and visits. Hours and days are counted in IST
// (Asia/Kolkata), because that is the society's clock, not UTC.
import { prisma } from "../db.js";

const TZ = "Asia/Kolkata";

export interface Overview {
  days: number;
  since: string;
  totals: {
    gateEvents: number;
    residentEntries: number;
    visits: number;
    /** Visits that ended in the window and have a duration. */
    completedVisits: number;
  };
  /** Average minutes inside for completed visits, or null when there were none. */
  averageVisitMinutes: number | null;
  /** Share (0–1) of visits that entered in the window and went past their time limit. */
  overstayRate: number | null;
  /** Entry-lane reads per IST hour, 0–23 (all 24 present). */
  busiestHours: { hour: number; entries: number }[];
  /** One row per IST day in the window, oldest first (all days present). */
  daily: { date: string; residentEntries: number; visits: number }[];
  byCategory: { category: string; visits: number }[];
  frequentVisitors: { plate: string; visits: number; lastVisitAt: string; flatLabel: string }[];
}

/** IST calendar date (YYYY-MM-DD) of an instant. */
export function istDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

/** Dashboard numbers for the last `days` days up to `now`. */
export async function overview(days: number, now = new Date()): Promise<Overview> {
  const since = new Date(now.getTime() - days * 86_400_000);

  const [counts] = await prisma.$queryRaw<
    { events: bigint; resident_entries: bigint; visits: bigint }[]
  >`
    SELECT
      (SELECT count(*) FROM gate_events WHERE captured_at >= ${since} AND captured_at <= ${now}) AS events,
      (SELECT count(*) FROM gate_events WHERE captured_at >= ${since} AND captured_at <= ${now}
         AND direction = 'entry' AND match_result = 'resident') AS resident_entries,
      (SELECT count(*) FROM visits WHERE created_at >= ${since} AND created_at <= ${now}) AS visits`;

  const [durations] = await prisma.$queryRaw<{ completed: bigint; avg: number | null }[]>`
    SELECT count(*) AS completed, avg(duration_minutes)::float AS avg
    FROM visits
    WHERE exited_at >= ${since} AND exited_at <= ${now} AND duration_minutes IS NOT NULL`;

  // A visit "overstayed" if its history ever reached the overstayed status.
  const [overstay] = await prisma.$queryRaw<{ entered: bigint; overstayed: bigint }[]>`
    SELECT count(*) AS entered,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM visit_status_changes c
             WHERE c.visit_id = v.id AND c.to_status = 'overstayed')) AS overstayed
    FROM visits v
    WHERE v.entered_at >= ${since} AND v.entered_at <= ${now}`;

  const hours = await prisma.$queryRaw<{ hour: number; entries: bigint }[]>`
    SELECT extract(hour FROM captured_at AT TIME ZONE ${TZ})::int AS hour, count(*) AS entries
    FROM gate_events
    WHERE captured_at >= ${since} AND captured_at <= ${now} AND direction = 'entry'
    GROUP BY 1`;

  const dailyEntries = await prisma.$queryRaw<{ day: string; n: bigint }[]>`
    SELECT to_char(captured_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, count(*) AS n
    FROM gate_events
    WHERE captured_at >= ${since} AND captured_at <= ${now}
      AND direction = 'entry' AND match_result = 'resident'
    GROUP BY 1`;
  const dailyVisits = await prisma.$queryRaw<{ day: string; n: bigint }[]>`
    SELECT to_char(created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, count(*) AS n
    FROM visits
    WHERE created_at >= ${since} AND created_at <= ${now}
    GROUP BY 1`;

  const categories = await prisma.$queryRaw<{ category: string; n: bigint }[]>`
    SELECT category::text AS category, count(*) AS n
    FROM visits
    WHERE created_at >= ${since} AND created_at <= ${now}
    GROUP BY 1 ORDER BY 2 DESC, 1`;

  const frequent = await prisma.$queryRaw<
    { plate: string; n: bigint; last: Date; block: string; number: string }[]
  >`
    SELECT DISTINCT ON (t.plate) t.plate, t.n, t.last, f.block, f.number
    FROM (
      SELECT plate_normalized AS plate, count(*) AS n, max(created_at) AS last
      FROM visits
      WHERE created_at >= ${since} AND created_at <= ${now} AND plate_normalized IS NOT NULL
      GROUP BY 1 HAVING count(*) >= 2
    ) t
    JOIN visits v ON v.plate_normalized = t.plate AND v.created_at = t.last
    JOIN flats f ON f.id = v.flat_id
    ORDER BY t.plate`;

  const entered = Number(overstay?.entered ?? 0);
  const byHour = new Map(hours.map((h) => [h.hour, Number(h.entries)]));
  const entriesByDay = new Map(dailyEntries.map((d) => [d.day, Number(d.n)]));
  const visitsByDay = new Map(dailyVisits.map((d) => [d.day, Number(d.n)]));

  const daily: Overview["daily"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = istDate(new Date(now.getTime() - i * 86_400_000));
    daily.push({
      date,
      residentEntries: entriesByDay.get(date) ?? 0,
      visits: visitsByDay.get(date) ?? 0,
    });
  }

  return {
    days,
    since: since.toISOString(),
    totals: {
      gateEvents: Number(counts?.events ?? 0),
      residentEntries: Number(counts?.resident_entries ?? 0),
      visits: Number(counts?.visits ?? 0),
      completedVisits: Number(durations?.completed ?? 0),
    },
    averageVisitMinutes:
      durations?.avg === null || durations?.avg === undefined
        ? null
        : Math.round(durations.avg * 10) / 10,
    overstayRate:
      entered === 0
        ? null
        : Math.round((Number(overstay?.overstayed ?? 0) / entered) * 1000) / 1000,
    busiestHours: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      entries: byHour.get(hour) ?? 0,
    })),
    daily,
    byCategory: categories.map((c) => ({ category: c.category, visits: Number(c.n) })),
    frequentVisitors: frequent
      .map((f) => ({
        plate: f.plate,
        visits: Number(f.n),
        lastVisitAt: f.last.toISOString(),
        flatLabel: `${f.block}-${f.number}`,
      }))
      .sort((a, b) => b.visits - a.visits || a.plate.localeCompare(b.plate))
      .slice(0, 10),
  };
}

export interface Inside {
  visitors: {
    visitId: string;
    plate: string | null;
    visitorName: string | null;
    flatLabel: string;
    category: string;
    status: string;
    enteredAt: string | null;
    expectedExitAt: string | null;
  }[];
  /** Resident vehicles whose most recent camera read was an entry. */
  residentVehicles: number;
  total: number;
}

/** Who is inside right now: visitors (by visit status) + resident cars (by last read). */
export async function inside(): Promise<Inside> {
  const visits = await prisma.visit.findMany({
    where: { status: { in: ["inside", "overstayed", "escalated"] } },
    include: { visitor: { select: { fullName: true } }, flat: true },
    orderBy: { enteredAt: "asc" },
  });
  const [resident] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM (
      SELECT DISTINCT ON (vehicle_id) direction
      FROM gate_events
      WHERE vehicle_id IS NOT NULL AND match_result = 'resident'
      ORDER BY vehicle_id, captured_at DESC
    ) last WHERE direction = 'entry'`;
  const residentVehicles = Number(resident?.n ?? 0);
  return {
    visitors: visits.map((v) => ({
      visitId: v.id,
      plate: v.plateNormalized,
      visitorName: v.visitor?.fullName ?? null,
      flatLabel: `${v.flat.block}-${v.flat.number}`,
      category: v.category,
      status: v.status,
      enteredAt: v.enteredAt?.toISOString() ?? null,
      expectedExitAt: v.expectedExitAt?.toISOString() ?? null,
    })),
    residentVehicles,
    total: residentVehicles + visits.length,
  };
}
