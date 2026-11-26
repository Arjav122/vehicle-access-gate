// Admin: society settings (time limits per visit category, approval timeout, OCR confidence
// threshold, how long visitor data is kept). Saves only what changed; every change is audited.
// In demo mode there is also "Reset demo": wipe and re-seed (everybody is signed out).
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { type SubmitEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, ErrorState, ListSkeleton } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { useDemo, useSignOut } from "@/features/auth/session";
import { useAction } from "@/features/shared/hooks";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api";

type Settings = Schemas["Settings"];
type Key = keyof Settings;

const FIELDS: { key: Key; label: string; hint: string; step?: string }[] = [
  { key: "guestMinutes", label: "Guest limit (minutes)", hint: "Default 240 (4 hours)" },
  { key: "deliveryMinutes", label: "Delivery limit (minutes)", hint: "Default 20" },
  { key: "cabMinutes", label: "Cab limit (minutes)", hint: "Default 10" },
  { key: "serviceMinutes", label: "Service limit (minutes)", hint: "Default 120" },
  {
    key: "approvalTimeoutSeconds",
    label: "Resident answer time (seconds)",
    hint: "After this the guard decides. Default 180",
  },
  {
    key: "confidenceThreshold",
    label: "OCR confidence threshold (0–1)",
    hint: "Reads below this go to the guard's review queue. Default 0.80",
    step: "0.01",
  },
  {
    key: "visitorRetentionDays",
    label: "Keep visitor details (days)",
    hint: "Names, phones and emails are erased after this. Default 90",
  },
];

function SettingsForm({ settings }: { settings: Settings }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, String(settings[f.key])])),
  );
  const save = useAction(
    (body: Partial<Settings>) => unwrap(api.PATCH("/api/settings", { body })),
    { success: "Settings saved", invalidate: ["settings", "audit-logs"] },
  );
  const changed: Partial<Settings> = {};
  for (const f of FIELDS) {
    const n = Number(values[f.key]);
    if (values[f.key] !== "" && Number.isFinite(n) && n !== settings[f.key]) changed[f.key] = n;
  }
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    save.mutate(changed);
  };
  return (
    <form className="grid gap-4 p-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="decimal"
                step={f.step ?? "1"}
                min="0"
                value={values[f.key] ?? ""}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [f.key]: e.target.value }));
                }}
              />
            )}
          </Field>
        ))}
      </div>
      <div className="flex justify-end">
        <Button
          type="submit"
          variant="primary"
          disabled={save.isPending || Object.keys(changed).length === 0}
        >
          Save changes
        </Button>
      </div>
    </form>
  );
}

function DemoReset() {
  const demo = useDemo();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const reset = useAction(() => unwrap(api.POST("/api/demo/reset", { body: { history: true } })));
  if (!demo.data) return null; // demo mode is off: no reset in a real society
  return (
    <Card>
      <CardHeader
        title="Demo data"
        description="Wipe everything and load the demo society again: 14 days of history plus a live 'right now' state. Takes about a minute and a half and signs everybody out."
        action={
          <Button
            variant="danger"
            size="sm"
            disabled={reset.isPending || demo.data.resetting}
            onClick={() => {
              setConfirm(true);
            }}
          >
            <RotateCcw aria-hidden /> Reset demo
          </Button>
        }
      />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Reset the demo?"
        description="All visits, gate events and changes are deleted and the demo society is loaded again. Everybody is signed out. This can't be undone."
        confirmLabel="Reset demo"
        pending={reset.isPending}
        onConfirm={() => {
          reset.mutate(undefined, {
            onSuccess: () => {
              setConfirm(false);
              toast.success("Demo reset started. Sign in again in about a minute and a half.");
              signOut();
              void navigate("/login");
            },
          });
        }}
      />
    </Card>
  );
}

export default function SettingsPage() {
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () => unwrap(api.GET("/api/settings")),
  });
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card>
        <CardHeader title="Society rules" description="Applies to new visits from now on" />
        {q.isPending ? (
          <ListSkeleton rows={4} />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : (
          <SettingsForm key={JSON.stringify(q.data)} settings={q.data} />
        )}
      </Card>
      <DemoReset />
    </div>
  );
}
