// A guest shows the guard a pass code (8 characters, no look-alike letters). Redeeming it
// creates the visit already approved and lets them in.
import { Loader2 } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { useAction } from "@/features/shared/hooks";
import { api, unwrap } from "@/lib/api";

export function GuestCodeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [plate, setPlate] = useState("");
  const redeem = useAction(
    (body: { code: string; plate?: string }) =>
      unwrap(api.POST("/api/guest-passes/redeem", { body })),
    {
      success: (v) => `Guest pass accepted: visit to ${v.flatLabel} started`,
      invalidate: ["visits", "inside", "gate-events"],
    },
  );
  const close = () => {
    setCode("");
    setPlate("");
    onClose();
  };
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    redeem.mutate(
      { code: code.replace(/[\s-]/g, ""), ...(plate.trim() ? { plate: plate.trim() } : {}) },
      { onSuccess: close },
    );
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title="Guest pass code"
      description="Type the code the guest shows you. Each code works only within its validity window."
    >
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="Code">
          {(p) => (
            <Input
              {...p}
              value={code}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="ABCD 2345"
              className="h-12 font-plate text-xl tracking-widest uppercase"
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
              }}
            />
          )}
        </Field>
        <Field label="Plate (optional)" hint="If the guest came by car">
          {(p) => (
            <Input
              {...p}
              value={plate}
              autoCapitalize="characters"
              onChange={(e) => {
                setPlate(e.target.value.toUpperCase());
              }}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={redeem.isPending || code.replace(/[\s-]/g, "").length < 4}
          >
            {redeem.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Let the guest in
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
