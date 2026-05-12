"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { apiV1 } from "@/config/api";
import { api } from "@/lib/api";

type Vehicle = {
  id: string;
  plate_raw: string;
  plate_normalized: string;
  vehicle_type: string | null;
  is_inside: boolean;
  resident_id: string | null;
};

export default function VehiclesPage() {
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [plate, setPlate] = useState("");
  const [residentId, setResidentId] = useState("");
  const [vehicleType, setVehicleType] = useState("");

  async function load() {
    setRows(await api<Vehicle[]>(apiV1("/vehicles")));
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await api(apiV1("/vehicles"), {
      method: "POST",
      body: JSON.stringify({
        plate_raw: plate,
        resident_id: residentId.trim() ? residentId.trim() : null,
        vehicle_type: vehicleType.trim() || null,
      }),
    });
    setPlate("");
    setResidentId("");
    setVehicleType("");
    await load();
  }

  return (
    <PageShell title="Vehicles">
      <p className="mb-6 max-w-2xl text-sm text-slate-600">
        Link plates to residents. Use vehicle type (e.g. SUV, sedan, two-wheeler) for clearer gate display.
      </p>
      <form
        onSubmit={add}
        className="mb-8 flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div>
          <Label>Plate</Label>
          <Input value={plate} onChange={(e) => setPlate(e.target.value)} required className="mt-1 w-48" />
        </div>
        <div>
          <Label>Vehicle type</Label>
          <Input
            value={vehicleType}
            onChange={(e) => setVehicleType(e.target.value)}
            placeholder="e.g. SUV"
            className="mt-1 w-40"
          />
        </div>
        <div>
          <Label>Resident ID</Label>
          <Input
            value={residentId}
            onChange={(e) => setResidentId(e.target.value)}
            placeholder="UUID from Residents"
            className="mt-1 w-72 font-mono text-xs"
          />
        </div>
        <Button type="submit">Register vehicle</Button>
      </form>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/90">
              <TableHead>Plate</TableHead>
              <TableHead>Normalized</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Resident</TableHead>
              <TableHead>On site</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((v) => (
              <TableRow key={v.id} className="hover:bg-slate-50/50">
                <TableCell className="font-mono font-medium">{v.plate_raw}</TableCell>
                <TableCell className="font-mono text-xs text-slate-600">{v.plate_normalized}</TableCell>
                <TableCell>{v.vehicle_type ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs text-slate-500">{v.resident_id ?? "—"}</TableCell>
                <TableCell>
                  {v.is_inside ? <Badge className="bg-emerald-600">Inside</Badge> : <Badge variant="secondary">Out</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PageShell>
  );
}
