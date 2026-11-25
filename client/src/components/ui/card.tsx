// Surfaces: Card (1 px border, no shadow), Skeleton (loading), EmptyState, ErrorState, Badge.
import { AlertTriangle, Inbox } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-lg border border-border bg-background", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn("flex items-start justify-between gap-3 border-b border-border p-4", className)}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

/** A few grey bars while a list loads. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid gap-3 p-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <div className="text-muted-foreground [&_svg]:size-6">{icon ?? <Inbox />}</div>
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-xs text-xs text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <AlertTriangle className="size-6 text-danger" aria-hidden />
      <p className="text-sm font-medium">Couldn&apos;t load this</p>
      <p className="max-w-xs text-xs text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

const TONES = {
  neutral: "bg-muted text-muted-foreground border-border",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
