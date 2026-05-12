"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiV1 } from "@/config/api";
import { ShieldAlert, ShieldCheck, Video, ScanLine, Loader2 } from "lucide-react";

type DetectionResult = {
  plate_text: string | null;
  confidence?: number | null;
  detail?: string | null;
  candidates: string[];
  recommend_rescan?: boolean;
};

type AccessResult = {
  authorized: boolean;
  action: string;
  message: string;
  requires_visitor_registration?: boolean;
  resident_name?: string | null;
  unit_number?: string | null;
};

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Click Start Camera to begin gate scanning.");
  const [lastConfidence, setLastConfidence] = useState<number | null>(null);
  const [lastInterpretedPlate, setLastInterpretedPlate] = useState<string | null>(null);
  const [lastAccess, setLastAccess] = useState<AccessResult | null>(null);
  const [showVisitorForm, setShowVisitorForm] = useState(false);
  const [plateLocked, setPlateLocked] = useState("");
  const [manualPlate, setManualPlate] = useState("");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    purpose: "",
    expected_duration_minutes: 60,
  });

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
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
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraOn(true);
    } catch {
      setStatus("Camera permission denied or unavailable.");
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  /** Capture 2–3 quick JPEGs at high quality for backend consensus (same form field `file`). */
  const captureFrameBlobs = useCallback(async (count: number): Promise<Blob[]> => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      return [];
    }
    const blobs: Blob[] = [];
    const jpegQuality = 0.96;
    const delayMs = 55;

    for (let i = 0; i < count; i += 1) {
      if (i > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delayMs);
        });
      }
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) {
        break;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/jpeg", jpegQuality);
      });
      if (blob) {
        blobs.push(blob);
      }
    }
    return blobs;
  }, []);

  const processPlate = useCallback(
    async (plateRaw: string, sourceLabel: string) => {
      const plate = plateRaw.trim();
      if (!plate) {
        setStatus("Please enter a plate number.");
        return;
      }
      const base = process.env.NEXT_PUBLIC_API_URL || "";
      const accessRes = await fetch(`${base}${apiV1("/access/process")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plate_text: plate }),
      });
      const access = (await accessRes.json()) as AccessResult;
      setLastInterpretedPlate(plate);
      setLastAccess(access);
      if (access.authorized) {
        setStatus(`GREEN: ACCESS GRANTED (${sourceLabel})`);
        setShowVisitorForm(false);
      } else if (access.requires_visitor_registration) {
        setStatus(`RED: UNAUTHORIZED VEHICLE (${sourceLabel}) - Apply gate pass.`);
        setPlateLocked(plate);
        setShowVisitorForm(true);
      } else {
        setStatus(`RED: ACCESS DENIED (${sourceLabel})`);
        setShowVisitorForm(false);
      }
    },
    [],
  );

  const scan = useCallback(async () => {
    if (!cameraOn) {
      return;
    }
    setBusy(true);
    setLastConfidence(null);
    setLastInterpretedPlate(null);
    setLastAccess(null);
    try {
      setStatus("Scanning...");
      const blobs = await captureFrameBlobs(3);
      if (!blobs.length) {
        setStatus("Could not capture camera frames. Please rescan.");
        return;
      }
      const base = process.env.NEXT_PUBLIC_API_URL || "";
      const fd = new FormData();
      for (let i = 0; i < blobs.length; i += 1) {
        fd.append("file", blobs[i]!, `frame-${i}.jpg`);
      }
      const detRes = await fetch(`${base}${apiV1("/detection/analyze")}`, {
        method: "POST",
        body: fd,
      });
      const det = (await detRes.json()) as DetectionResult;
      const plate = (det.plate_text?.trim() || det.candidates?.[0]?.trim() || null);
      setLastConfidence(det.confidence ?? null);
      setLastInterpretedPlate(plate);
      if (!plate) {
        const hint = det.detail?.trim() || "Please Rescan.";
        setStatus(hint);
        setLastAccess({
          authorized: false,
          action: "unauthorized",
          message: hint,
          requires_visitor_registration: false,
        });
        setShowVisitorForm(false);
        return;
      }
      const pct = det.confidence != null ? `${Math.round(det.confidence * 100)}%` : "n/a";
      const rescanHint = det.recommend_rescan ? " If unsure, rescan for a clearer read." : "";
      setStatus(`Plate detected: ${plate} (confidence ${pct}).${rescanHint}`);

      await processPlate(plate, `${pct} OCR confidence`);
      setManualPlate(plate);
    } finally {
      setBusy(false);
    }
  }, [cameraOn, captureFrameBlobs, processPlate]);

  async function submitManualPlate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLastAccess(null);
    try {
      await processPlate(manualPlate, "manual entry");
    } finally {
      setBusy(false);
    }
  }

  async function submitVisitor(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const base = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${base}${apiV1("/visitors/gate-request")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          purpose: form.purpose,
          meet_person: "Gate",
          visit_unit: null,
          plate_raw: plateLocked,
          expected_duration_minutes: form.expected_duration_minutes,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || "Failed to submit visitor request");
      }
      setShowVisitorForm(false);
      setForm({ name: "", phone: "", purpose: "", expected_duration_minutes: 60 });
      setStatus("Visitor request submitted. Waiting for admin approval.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to submit visitor request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">AI Vehicle Access Management - Gate Camera</h1>
          <Link className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white" href="/login">
            Admin Login
          </Link>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex gap-2">
              {!cameraOn ? (
                <button
                  type="button"
                  onClick={startCamera}
                  className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-white"
                >
                  <Video className="mr-2 h-4 w-4" /> Start Camera
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={scan}
                    disabled={busy}
                    className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-white"
                  >
                    <ScanLine className="mr-2 h-4 w-4" /> Scan Plate
                  </button>
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="inline-flex items-center rounded-md border border-slate-300 px-4 py-2"
                  >
                    Stop Camera
                  </button>
                </>
              )}
            </div>
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full object-cover" />
              {cameraOn && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div className={`scanline-motion absolute left-0 right-0 h-0.5 bg-emerald-400 ${busy ? "opacity-100" : "opacity-60"}`} />
                </div>
              )}
              {busy && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 className="h-10 w-10 animate-spin text-white" />
                </div>
              )}
            </div>
            {lastConfidence != null && (
              <p className="mt-2 text-xs text-slate-500">
                OCR confidence: <span className="font-semibold">{Math.round(lastConfidence * 100)}%</span>
              </p>
            )}
            {lastInterpretedPlate && (
              <p className="mt-1 text-xs text-slate-500">
                Interpreted plate: <span className="font-mono font-semibold text-slate-700">{lastInterpretedPlate}</span>
              </p>
            )}
            <p className="mt-3 text-sm text-slate-600">{status}</p>
            <form onSubmit={submitManualPlate} className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Manual plate entry (if extraction fails)
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm uppercase"
                  placeholder="Enter plate, e.g. WB06F5977"
                  value={manualPlate}
                  onChange={(e) => setManualPlate(e.target.value.toUpperCase())}
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  Check Manually
                </button>
              </div>
            </form>
          </section>
          <section className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-lg font-semibold">Authorization Result</h2>
              {!lastAccess ? (
                <p className="text-sm text-slate-500">No scan processed yet.</p>
              ) : lastAccess.authorized ? (
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
                  <div className="mb-1 flex items-center gap-2 font-semibold">
                    <ShieldCheck className="h-5 w-5" /> ACCESS GRANTED
                  </div>
                  <p className="text-sm">{lastAccess.message}</p>
                  {lastAccess.resident_name && (
                    <p className="text-sm">
                      Resident: {lastAccess.resident_name} {lastAccess.unit_number ? `(${lastAccess.unit_number})` : ""}
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-900">
                  <div className="mb-1 flex items-center gap-2 font-semibold">
                    <ShieldAlert className="h-5 w-5" /> UNAUTHORIZED
                  </div>
                  <p className="text-sm">{lastAccess.message}</p>
                </div>
              )}
            </div>
            {showVisitorForm && (
              <form onSubmit={submitVisitor} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-lg font-semibold">Visitor Gate Pass Request</h2>
                <input className="mb-2 w-full rounded border p-2 font-mono" value={plateLocked} readOnly />
                <input
                  className="mb-2 w-full rounded border p-2"
                  placeholder="Visitor name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
                <input
                  className="mb-2 w-full rounded border p-2"
                  placeholder="Mobile number"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  required
                />
                <input
                  className="mb-2 w-full rounded border p-2"
                  placeholder="Purpose"
                  value={form.purpose}
                  onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                  required
                />
                <input
                  type="number"
                  min={1}
                  className="mb-3 w-full rounded border p-2"
                  value={form.expected_duration_minutes}
                  onChange={(e) => setForm({ ...form, expected_duration_minutes: Number(e.target.value) })}
                  required
                />
                <button type="submit" disabled={busy} className="rounded-md bg-slate-900 px-4 py-2 text-white">
                  Submit For Approval
                </button>
              </form>
            )}
          </section>
        </div>
      </div>
      <style jsx global>{`
        @keyframes scanline-move {
          0% {
            transform: translateY(10%);
          }
          50% {
            transform: translateY(50%);
          }
          100% {
            transform: translateY(90%);
          }
        }
        .scanline-motion {
          animation: scanline-move 1.6s ease-in-out infinite;
          box-shadow: 0 0 12px rgba(52, 211, 153, 0.9);
        }
      `}</style>
    </main>
  );
}
