// Shared hooks: a ticking clock for countdowns, media queries, debounced values, and a
// mutation helper that toasts success / failure and refreshes the right lists.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api";

/** The current time, re-rendering every `ms` (countdowns, "5 min ago"). */
export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
    }, ms);
    return () => {
      clearInterval(id);
    };
  }, [ms]);
  return now;
}

/** true while the media query matches (e.g. "(min-width: 1280px)"). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => {
        m.removeEventListener("change", onChange);
      };
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );
}

/**
 * useMutation + toasts + invalidation. `invalidate` lists query keys (first segment) whose
 * screens must refetch after success, e.g. ["gate-events", "visits"].
 */
export function useAction<TInput, TResult>(
  fn: (input: TInput) => Promise<TResult>,
  opts: { success?: string | ((r: TResult) => string); invalidate?: string[] } = {},
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      for (const key of opts.invalidate ?? []) void client.invalidateQueries({ queryKey: [key] });
      const msg = typeof opts.success === "function" ? opts.success(result) : opts.success;
      if (msg) toast.success(msg);
    },
    onError: (err) => {
      toast.error(errorMessage(err));
    },
  });
}

/** `value`, but only after it stopped changing for `ms` (one request per pause in typing). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => {
      setV(value);
    }, ms);
    return () => {
      clearTimeout(id);
    };
  }, [value, ms]);
  return v;
}
