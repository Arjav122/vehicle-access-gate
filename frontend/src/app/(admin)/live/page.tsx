"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiV1 } from "@/config/api";
import { api, getApiBase, getToken } from "@/lib/api";
import { ShieldAlert, ShieldCheck, Video, ScanLine, Loader2 } from "lucide-react";

type DetResult = {
  plate_text: string | null;
  confidence?: number | null;
  detection_confidence?: number | null;
  plate_boxes_found?: number;
  detail?: string | null;
  candidates?: string[];
};

type AccessResult = {
  authorized: boolean;
  action: string;
  message: string;
  requires_visitor_registration?: boolean;
  resident_name?: string | null;
  unit_number?: string | null;
  vehicle_type?: string | null;
  vehicle?: { plate_raw?: string; plate_normalized?: string } | null;
};

export default function LivePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [status, setStatus] = useState<string>("Press “Start vehicle check” to enable the gate camera.");
  const [busy, setBusy] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [lastDet, setLastDet] = useState<DetResult | null>(null);
  const [lastAccess, setLastAccess] = useState<AccessResult | null>(null);
  const [showVisitorForm, setShowVisitorForm] = useState(false);
  const [plateLocked, setPlateLocked] = useState("");

  const [vName, setVName] = useState("");
  const [vPhone, setVPhone] = useState("");
  const [vPurpose, setVPurpose] = useState("");
  const [vMeet, setVMeet] = useState("");
  const [vUnit, setVUnit] = useState("");
  const [vDuration, setVDuration] = useState(120);
  const [kioskAck, setKioskAck] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setContinuous(false);
    setStatus("Camera stopped.");
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraOn(true);
      setStatus("Live preview — run a scan or enable continuous mode.");
    } catch {
      setStatus("Camera unavailable or permission denied.");
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const captureFrameBlobs = useCallback(async (count: number): Promise<Blob[]> => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return [];
    const blobs: Blob[] = [];
    const q = 0.96;
    for (let i = 0; i < count; i += 1) {
      if (i > 0) await new Promise<void>((r) => setTimeout(r, 55));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) break;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/jpeg", q));
      if (blob) blobs.push(blob);
    }
    return blobs;
  }, []);

  const runDetectionAndAccess = useCallback(async () => {
    if (!cameraOn) return;
    setBusy(true);
    setLastAccess(null);
    setKioskAck(null);
    try {
      const blobs = await captureFrameBlobs(3);
      if (!blobs.length) {
        setStatus("Could not capture frame.");
        return;
      }
      const token = getToken();
      const base = getApiBase();
      const fd = new FormData();
      for (let i = 0; i < blobs.length; i += 1) {
        fd.append("file", blobs[i]!, `frame-${i}.jpg`);
      }
      const det = await fetch(`${base}${apiV1("/detection/analyze")}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });
      const detText = await det.text();
      let detJson: DetResult;
      try {
        detJson = JSON.parse(detText) as DetResult;
      } catch {
        setStatus(detText || "Detection failed");
        return;
      }
      setLastDet(detJson);
      const plate = detJson.plate_text || detJson.candidates?.[0];
      const pct = (n: number | null | undefined) =>
        n == null || Number.isNaN(n) ? "—" : `${Math.round(Number(n) * 1000) / 10}%`;
      setStatus(
        `Scan: boxes ${detJson.plate_boxes_found ?? 0} · detector ${pct(
          detJson.detection_confidence ?? null,
        )} · OCR ${pct(detJson.confidence ?? null)}`,
      );
      if (!plate) {
        setShowVisitorForm(false);
        setPlateLocked("");
        return;
      }
      const accRes = await fetch(`${base}${apiV1("/access/process")}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ plate_text: plate }),
      });
      const accBody = await accRes.json().catch(() => ({}));
      if (!accRes.ok) {
        setStatus(typeof accBody === "string" ? accBody : accBody?.detail || "Access API error");
        return;
      }
      const acc = accBody as AccessResult;
      setLastAccess(acc);
      if (acc.authorized) {
        setShowVisitorForm(false);
        setPlateLocked("");
      } else if (acc.requires_visitor_registration) {
        setPlateLocked(plate);
        setShowVisitorForm(true);
        setStatus("Unknown vehicle — complete visitor details for approval.");
      } else {
        setShowVisitorForm(false);
      }
    } finally {
      setBusy(false);
    }
  }, [cameraOn, captureFrameBlobs]);

  useEffect(() => {
    if (!continuous || !cameraOn) return;
    const id = window.setInterval(() => {
      runDetectionAndAccess().catch(console.error);
    }, 2500);
    return () => window.clearInterval(id);
  }, [continuous, cameraOn, runDetectionAndAccess]);

  async function submitVisitor(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(apiV1("/visitors/gate-request"), {
        method: "POST",
        body: JSON.stringify({
          name: vName,
          phone: vPhone,
          purpose: vPurpose,
          meet_person: vMeet,
          visit_unit: vUnit || null,
          plate_raw: plateLocked,
          expected_duration_minutes: vDuration,
        }),
      });
      setShowVisitorForm(false);
      setLastAccess(null);
      setKioskAck("Visitor request submitted — pending admin approval. Check Gate approvals.");
      setStatus("Visitor request queued for approval.");
      setVName("");
      setVPhone("");
      setVPurpose("");
      setVMeet("");
      setVUnit("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  const granted = lastAccess?.authorized && lastAccess.action === "authorized";
  const isVisitorPass = Boolean(granted && !lastAccess?.vehicle);
  const isRegistered = Boolean(granted && !!lastAccess?.resident_name);

  return (
    <PageShell title="Gate camera">
      <div className="mx-auto max-w-6xl space-y-6">
        <p className="text-sm text-slate-600">
          Secure gate workflow: start the camera only when needed, scan plates with ANPR, and route unknown vehicles
          through visitor approval.
        </p>
        {kioskAck && (
          <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">{kioskAck}</div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-slate-50/80">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Video className="h-5 w-5 text-emerald-600" />
                Camera
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              {!cameraOn ? (
                <Button
                  size="lg"
                  className="h-14 w-full bg-emerald-600 text-base font-semibold hover:bg-emerald-700"
                  onClick={startCamera}
                >
                  Start vehicle check
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="relative overflow-hidden rounded-xl bg-black ring-1 ring-slate-200">
                    <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full object-cover" />
                    {busy && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <Loader2 className="h-10 w-10 animate-spin text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={stopCamera}>
                      Stop camera
                    </Button>
                    <Button onClick={() => runDetectionAndAccess()} disabled={busy}>
                      <ScanLine className="mr-2 h-4 w-4" />
                      Scan plate now
                    </Button>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={continuous}
                        onChange={(e) => setContinuous(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      Continuous scan (~2.5s)
                    </label>
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-500">{status}</p>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 bg-slate-50/80">
                <CardTitle className="text-base font-semibold">ANPR readout</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-5 text-sm">
                {lastDet ? (
                  <>
                    <div className="flex flex-wrap gap-4 text-slate-700">
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Plate</div>
                        <div className="font-mono text-lg font-semibold text-slate-900">
                          {lastDet.plate_text || lastDet.candidates?.[0] || "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Detector</div>
                        <div>
                          {lastDet.detection_confidence != null
                            ? `${(lastDet.detection_confidence * 100).toFixed(1)}%`
                            : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">OCR</div>
                        <div>
                          {lastDet.confidence != null ? `${(lastDet.confidence * 100).toFixed(1)}%` : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Boxes</div>
                        <div>{lastDet.plate_boxes_found ?? 0}</div>
                      </div>
                    </div>
                    {lastDet.detail ? <p className="text-xs text-amber-700">{lastDet.detail}</p> : null}
                  </>
                ) : (
                  <p className="text-slate-500">No scan yet.</p>
                )}
              </CardContent>
            </Card>

            {granted && isVisitorPass && (
              <Card className="border-2 border-teal-500 bg-teal-50/95 shadow-md">
                <CardContent className="flex flex-col gap-2 p-6">
                  <div className="flex items-center gap-2 text-lg font-bold text-teal-950">
                    <ShieldCheck className="h-7 w-7 text-teal-600" />
                    TEMPORARY ACCESS GRANTED
                  </div>
                  <p className="text-sm text-teal-900">{lastAccess?.message}</p>
                  <p className="text-xs text-teal-800">Visitor pass entry logged.</p>
                </CardContent>
              </Card>
            )}

            {granted && isRegistered && (
              <Card
                className={`border-2 shadow-md ${
                  isEntry ? "border-emerald-500 bg-emerald-50/90" : "border-sky-500 bg-sky-50/90"
                }`}
              >
                <CardContent className="flex flex-col gap-3 p-6">
                  <div className="flex items-center gap-2 text-lg font-bold text-emerald-900">
                    <ShieldCheck className="h-7 w-7 text-emerald-600" />
                    ACCESS GRANTED
                  </div>
                  {lastAccess?.resident_name != null && (
                    <div className="grid gap-1 text-sm text-emerald-950">
                      <div>
                        <span className="text-emerald-700">Resident:</span>{" "}
                        <span className="font-medium">{lastAccess.resident_name}</span>
                      </div>
                      <div>
                        <span className="text-emerald-700">Flat / unit:</span>{" "}
                        <span className="font-medium">{lastAccess.unit_number || "—"}</span>
                      </div>
                      <div>
                        <span className="text-emerald-700">Plate:</span>{" "}
                        <span className="font-mono font-semibold">
                          {lastAccess.vehicle?.plate_normalized || lastDet?.plate_text}
                        </span>
                      </div>
                      <div>
                        <span className="text-emerald-700">Vehicle:</span>{" "}
                        <span className="font-medium">{lastAccess.vehicle_type || "Registered vehicle"}</span>
                      </div>
                    </div>
                  )}
                  {!lastAccess?.resident_name && lastAccess?.vehicle && (
                    <p className="text-sm text-emerald-900">
                      Plate <span className="font-mono font-semibold">{lastAccess.vehicle.plate_normalized}</span>{" "}
                      is authorized.
                    </p>
                  )}
                  <p className="text-xs text-emerald-800">{lastAccess?.message}</p>
                </CardContent>
              </Card>
            )}

            {lastAccess && !lastAccess.authorized && !showVisitorForm && (
              <Card className="border-amber-200 bg-amber-50/90 shadow-sm">
                <CardContent className="flex items-start gap-3 p-5 text-sm text-amber-950">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <div className="font-semibold">Access not granted</div>
                    <p className="mt-1">{lastAccess.message}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {showVisitorForm && (
              <Card className="border-slate-300 shadow-lg">
                <CardHeader className="border-b border-slate-100 bg-slate-50">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldAlert className="h-5 w-5 text-amber-600" />
                    Unauthorized vehicle — visitor gate pass
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5">
                  <form className="grid gap-4 md:grid-cols-2" onSubmit={submitVisitor}>
                    <div className="md:col-span-2">
                      <Label>Plate (read only)</Label>
                      <Input readOnly value={plateLocked} className="mt-1 font-mono" />
                    </div>
                    <div>
                      <Label>Name</Label>
                      <Input required value={vName} onChange={(e) => setVName(e.target.value)} className="mt-1" />
                    </div>
                    <div>
                      <Label>Phone</Label>
                      <Input required value={vPhone} onChange={(e) => setVPhone(e.target.value)} className="mt-1" />
                    </div>
                    <div className="md:col-span-2">
                      <Label>Purpose</Label>
                      <Input required value={vPurpose} onChange={(e) => setVPurpose(e.target.value)} className="mt-1" />
                    </div>
                    <div>
                      <Label>Visiting person</Label>
                      <Input required value={vMeet} onChange={(e) => setVMeet(e.target.value)} className="mt-1" />
                    </div>
                    <div>
                      <Label>Flat / unit</Label>
                      <Input value={vUnit} onChange={(e) => setVUnit(e.target.value)} className="mt-1" />
                    </div>
                    <div>
                      <Label>Expected stay (minutes)</Label>
                      <Input
                        type="number"
                        min={15}
                        value={vDuration}
                        onChange={(e) => setVDuration(Number(e.target.value))}
                        className="mt-1"
                      />
                    </div>
                    <div className="md:col-span-2 flex gap-2">
                      <Button type="submit" disabled={busy}>
                        Submit for approval
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setShowVisitorForm(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                  <p className="mt-3 text-xs text-slate-500">
                    Creates a pending visitor request, registration log, and alert for admins. After approval, the
                    visitor pass becomes active and the gate can show temporary access granted on next scan.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
