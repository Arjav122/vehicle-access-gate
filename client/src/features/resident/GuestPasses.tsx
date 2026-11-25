// Resident: guest passes. Create one in a few taps (who, until when, optional plate); the
// code is shown ONCE, big, with a copy button. Passes can be revoked.
import { useQuery } from "@tanstack/react-query";
import { Copy, Plus, Ticket } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  ListSkeleton,
  type Tone,
} from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { PlateChip } from "@/components/ui/PlateChip";
import { useMe } from "@/features/auth/session";
import { useAction } from "@/features/shared/hooks";
import { api, errorMessage, unwrap, type Schemas } from "@/lib/api";
import { formatDateTime, passValidUntil } from "@/lib/format";

type Pass = Schemas["GuestPass"];

const STATE: Record<Pass["state"], { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "ok" },
  not_yet_valid: { label: "Starts later", tone: "info" },
  expired: { label: "Expired", tone: "neutral" },
  used_up: { label: "Used", tone: "neutral" },
  revoked: { label: "Revoked", tone: "danger" },
};

const VALIDITY = [
  { value: "today", label: "Until midnight tonight" },
  { value: "24h", label: "Next 24 hours" },
  { value: "3d", label: "Next 3 days" },
  { value: "7d", label: "Next 7 days" },
] as const;
type Validity = (typeof VALIDITY)[number]["value"];

function CreatePass({ onCreated }: { onCreated: (code: string | null) => void }) {
  const me = useMe();
  const flats = me.data?.flats ?? [];
  const [flatId, setFlatId] = useState(flats[0]?.id ?? "");
  const [guestName, setGuestName] = useState("");
  const [plate, setPlate] = useState("");
  const [validity, setValidity] = useState<Validity>("today");
  const [maxUses, setMaxUses] = useState(1);
  const create = useAction(
    () =>
      unwrap(
        api.POST("/api/guest-passes", {
          body: {
            flatId: flatId || (flats[0]?.id ?? ""),
            withCode: true,
            validUntil: passValidUntil(validity).toISOString(),
            maxUses,
            ...(guestName.trim() ? { guestName: guestName.trim() } : {}),
            ...(plate.trim() ? { plate: plate.trim() } : {}),
          },
        }),
      ),
    { invalidate: ["guest-passes"] },
  );
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    create.mutate(undefined, {
      onSuccess: (r) => {
        onCreated((r as { code?: string | null }).code ?? null);
      },
    });
  };
  return (
    <form className="grid gap-4" onSubmit={submit}>
      {flats.length > 1 ? (
        <Field label="Flat">
          {(p) => (
            <Select
              {...p}
              value={flatId}
              onChange={(e) => {
                setFlatId(e.target.value);
              }}
            >
              {flats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <Field label="Guest name (optional)">
        {(p) => (
          <Input
            {...p}
            value={guestName}
            placeholder="Anjali (sister)"
            onChange={(e) => {
              setGuestName(e.target.value);
            }}
          />
        )}
      </Field>
      <Field label="Car plate (optional)" hint="With a plate, the camera lets the car in by itself">
        {(p) => (
          <Input
            {...p}
            value={plate}
            autoCapitalize="characters"
            placeholder="UP16 AB 1234"
            onChange={(e) => {
              setPlate(e.target.value.toUpperCase());
            }}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valid">
          {(p) => (
            <Select
              {...p}
              value={validity}
              onChange={(e) => {
                setValidity(e.target.value as Validity);
              }}
            >
              {VALIDITY.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Entries allowed">
          {(p) => (
            <Select
              {...p}
              value={String(maxUses)}
              onChange={(e) => {
                setMaxUses(Number(e.target.value));
              }}
            >
              {[1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Button type="submit" variant="primary" size="lg" disabled={create.isPending}>
        Create pass
      </Button>
    </form>
  );
}

function PassRow({ p }: { p: Pass }) {
  const [confirm, setConfirm] = useState(false);
  const revoke = useAction(
    () => unwrap(api.POST("/api/guest-passes/{id}/revoke", { params: { path: { id: p.id } } })),
    { success: "Pass revoked", invalidate: ["guest-passes"] },
  );
  const s = STATE[p.state];
  return (
    <li className="flex items-center justify-between gap-3 p-3">
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{p.guestName ?? "Guest"}</span>
          <Badge tone={s.tone}>{s.label}</Badge>
          {p.plate ? <PlateChip plate={p.plate} size="sm" /> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Until {formatDateTime(p.validUntil)} · used {p.useCount} of {p.maxUses}
          {p.hasCode ? " · code" : ""}
        </p>
      </div>
      {p.state === "active" || p.state === "not_yet_valid" ? (
        <>
          <Button
            size="sm"
            onClick={() => {
              setConfirm(true);
            }}
          >
            Revoke
          </Button>
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title="Revoke this pass?"
            description="The code and plate stop working at once. This can't be undone."
            confirmLabel="Revoke pass"
            pending={revoke.isPending}
            onConfirm={() => {
              revoke.mutate(undefined, {
                onSuccess: () => {
                  setConfirm(false);
                },
              });
            }}
          />
        </>
      ) : null}
    </li>
  );
}

export default function GuestPasses() {
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["guest-passes"],
    queryFn: () => unwrap(api.GET("/api/guest-passes", { params: { query: { limit: 50 } } })),
  });
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Guest passes</h1>
        <Button
          variant="primary"
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus aria-hidden /> New pass
        </Button>
      </div>
      <Card>
        <CardHeader
          title="Your passes"
          description="Give the code to your guest; the guard types it at the gate."
        />
        {q.isPending ? (
          <ListSkeleton rows={3} />
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState
            icon={<Ticket />}
            title="No guest passes yet"
            description="Expecting someone? Create a pass so they don't wait at the gate."
          />
        ) : (
          <ul className="divide-y divide-border">
            {q.data.items.map((p) => (
              <PassRow key={p.id} p={p} />
            ))}
          </ul>
        )}
      </Card>

      <Dialog open={creating} onOpenChange={setCreating} title="New guest pass">
        <CreatePass
          onCreated={(c) => {
            setCreating(false);
            setCode(c);
            if (!c) toast.success("Pass created");
          }}
        />
      </Dialog>

      <Dialog
        open={code !== null}
        onOpenChange={(o) => {
          if (!o) setCode(null);
        }}
        title="Pass created"
        description="This code is shown only once. Send it to your guest now."
      >
        <div className="grid gap-4">
          <p
            className="rounded-lg border border-border bg-surface py-5 text-center font-plate text-4xl font-bold tracking-[0.3em]"
            aria-label={`Code ${code?.split("").join(" ") ?? ""}`}
          >
            {code}
          </p>
          <Button
            size="lg"
            onClick={() => {
              void navigator.clipboard
                .writeText(code ?? "")
                .then(() => toast.success("Code copied"));
            }}
          >
            <Copy aria-hidden /> Copy code
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
