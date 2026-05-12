"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiV1 } from "@/config/api";
import { api } from "@/lib/api";

type Resident = {
  id: string;
  name: string;
  phone: string | null;
  vehicle_plate_number: string | null;
};

export default function ResidentsPage() {
  const [rows, setRows] = useState<Resident[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [plate, setPlate] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const r = await api<Resident[]>(apiV1("/residents"));
    setRows(r);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await api(apiV1("/residents"), {
      method: "POST",
      body: JSON.stringify({
        name,
        phone: phone || null,
        vehicle_plate_number: plate || null,
      }),
    });
    setName("");
    setPhone("");
    setPlate("");
    await load();
  }

  async function removeResident(id: string) {
    if (!window.confirm("Delete this resident?")) return;
    setError(null);
    try {
      await api(apiV1(`/residents/${id}`), { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <PageShell title="Residents">
      <p className="mb-6 max-w-2xl text-sm text-slate-600">
        Residents are the primary authorization records for vehicle access.
      </p>
      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <form
        onSubmit={add}
        className="mb-8 grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2 lg:grid-cols-4"
      >
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1" />
        </div>
        <div>
          <Label>Mobile</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label>Vehicle Plate Number</Label>
          <Input value={plate} onChange={(e) => setPlate(e.target.value)} className="mt-1" />
        </div>
        <div className="flex items-end">
          <Button type="submit" className="w-full md:w-auto">
            Add resident
          </Button>
        </div>
      </form>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/90">
              <TableHead>Resident ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Vehicle Plate Number</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="hover:bg-slate-50/50">
                <TableCell className="font-mono text-xs text-slate-600">{r.id}</TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.phone ?? "—"}</TableCell>
                <TableCell className="font-mono text-slate-700">{r.vehicle_plate_number ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <Button variant="destructive" size="sm" onClick={() => removeResident(r.id)}>
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
