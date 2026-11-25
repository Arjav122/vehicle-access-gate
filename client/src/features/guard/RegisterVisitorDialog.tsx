// Register a visitor: flat, name, phone, email, purpose, category. Linked to the waiting car's
// camera read (gateEventId) when there is one, so the resident's "Approve" lets the car in at
// once. Opened from an arrival card, or from the webcam preview via /guard?register=<plate>&event=<id>.
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { PlateChip } from "@/components/ui/PlateChip";
import { useAction } from "@/features/shared/hooks";
import { api, type BodyOf, unwrap, type Schemas } from "@/lib/api";
import { CATEGORY_LABEL, normalizePhone } from "@/lib/format";
import { formatPlate } from "@/lib/plates";

type Category = Schemas["Visit"]["category"];

export interface RegisterTarget {
  plate?: string | undefined;
  gateEventId?: string | undefined;
}

function useFlatSearch(q: string) {
  return useQuery({
    queryKey: ["flats", { q }],
    queryFn: () =>
      unwrap(api.GET("/api/flats", { params: { query: { ...(q ? { q } : {}), limit: 8 } } })),
    staleTime: 60_000,
  });
}

export function RegisterVisitorDialog({
  target,
  onClose,
}: {
  target: RegisterTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Register visitor"
      description="The flat's residents get Approve / Deny on their phones. No answer in 3 minutes and you decide."
    >
      {/* Remount per target so the form starts fresh */}
      {target ? (
        <RegisterForm
          key={target.gateEventId ?? target.plate ?? "new"}
          target={target}
          onDone={onClose}
        />
      ) : null}
    </Dialog>
  );
}

function RegisterForm({ target, onDone }: { target: RegisterTarget; onDone: () => void }) {
  const [flatQuery, setFlatQuery] = useState("");
  const [flat, setFlat] = useState<Schemas["Flat"] | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [purpose, setPurpose] = useState("");
  const [category, setCategory] = useState<Category>("guest");
  const [plate, setPlate] = useState(target.plate ?? "");
  const [touched, setTouched] = useState(false);
  const flats = useFlatSearch(flatQuery.trim());

  const register = useAction(
    (body: BodyOf<"/api/visits", "post">) => unwrap(api.POST("/api/visits", { body })),
    {
      success: (v) => `Sent to ${v.flatLabel} for approval`,
      // Refresh arrivals at once, or the guard sees "Register" again and registers twice.
      invalidate: ["gate-events", "visits", "approvals"],
    },
  );

  const errors = {
    flat: flat ? undefined : "Pick the flat being visited",
    name: name.trim() ? undefined : "Enter the visitor's name",
    phone:
      phone.trim() && !/^\+?\d{10,15}$/.test(normalizePhone(phone))
        ? "10-digit mobile number"
        : undefined,
  };
  const valid = !errors.flat && !errors.name && !errors.phone;

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTouched(true);
    if (!valid || !flat) return;
    register.mutate(
      {
        flatId: flat.id,
        category,
        visitor: {
          fullName: name.trim(),
          ...(phone.trim() ? { phone: normalizePhone(phone) } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
        },
        ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
        ...(target.gateEventId
          ? { gateEventId: target.gateEventId }
          : plate.trim()
            ? { plate: plate.trim() }
            : {}),
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      {target.gateEventId && target.plate ? (
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface p-3">
          <PlateChip plate={target.plate} />
          <span className="text-sm text-muted-foreground">Car waiting at the gate</span>
        </div>
      ) : (
        <Field label="Plate (optional)" hint="If the visitor came by car">
          {(p) => (
            <Input
              {...p}
              value={plate}
              placeholder="UP16 AB 1234"
              autoCapitalize="characters"
              onChange={(e) => {
                setPlate(e.target.value.toUpperCase());
              }}
            />
          )}
        </Field>
      )}

      <Field label="Flat" error={touched ? errors.flat : undefined}>
        {(p) => (
          <div className="grid gap-2">
            <Input
              {...p}
              value={flat ? flat.label : flatQuery}
              placeholder="Type 402 or B-402"
              autoComplete="off"
              onChange={(e) => {
                setFlat(null);
                setFlatQuery(e.target.value);
              }}
            />
            {!flat && flatQuery.trim() ? (
              <div className="flex flex-wrap gap-2" role="listbox" aria-label="Matching flats">
                {flats.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-label="Searching" />
                ) : flats.data?.items.length ? (
                  flats.data.items.map((f) => (
                    <Button
                      key={f.id}
                      type="button"
                      size="sm"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        setFlat(f);
                      }}
                    >
                      {f.label}
                    </Button>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">No flat matches</span>
                )}
              </div>
            ) : null}
          </div>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Visitor name" error={touched ? errors.name : undefined}>
          {(p) => (
            <Input
              {...p}
              value={name}
              autoComplete="off"
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Mobile (optional)" error={touched ? errors.phone : undefined}>
          {(p) => (
            <Input
              {...p}
              value={phone}
              inputMode="tel"
              placeholder="10-digit number"
              onChange={(e) => {
                setPhone(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Email (optional)" hint="Gets the visit details">
          {(p) => (
            <Input
              {...p}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Category">
          {(p) => (
            <Select
              {...p}
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as Category);
              }}
            >
              {(["guest", "delivery", "cab", "service"] as const).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Purpose (optional)">
        {(p) => (
          <Input
            {...p}
            value={purpose}
            placeholder="Amazon parcel, plumber, family visit…"
            onChange={(e) => {
              setPurpose(e.target.value);
            }}
          />
        )}
      </Field>

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="lg" disabled={register.isPending}>
          {register.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Ask {flat ? flat.label : "the flat"}
          {target.plate ? ` about ${formatPlate(target.plate)}` : ""}
        </Button>
      </div>
    </form>
  );
}
