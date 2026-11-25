// Dialogs on Radix (focus trap, Esc to close, aria wiring). `Dialog` for forms,
// `ConfirmDialog` for destructive actions ("Delete vehicle?").
import { X } from "lucide-react";
import { AlertDialog as AD, Dialog as D } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const overlay = "fixed inset-0 z-40 bg-black/50";
const panel =
  "fixed left-1/2 top-1/2 z-50 grid max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-background p-5";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content className={cn(panel, className)} aria-describedby={undefined}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1 text-sm text-muted-foreground">
                  {description}
                </D.Description>
              ) : null}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X />
              </Button>
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className={overlay} />
        <AD.Content className={panel}>
          <AD.Title className="text-base font-semibold">{title}</AD.Title>
          <AD.Description className="text-sm text-muted-foreground">{description}</AD.Description>
          <div className="flex justify-end gap-2">
            <AD.Cancel asChild>
              <Button>Cancel</Button>
            </AD.Cancel>
            <Button variant="danger" disabled={pending} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}
