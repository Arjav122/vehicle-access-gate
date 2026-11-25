// App-wide providers: data cache (TanStack Query), toasts (sonner), theme, and the single
// real-time connection for this tab.
import { type QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast, Toaster } from "sonner";
import { formatPlate } from "@/lib/plates";
import { type ConnectionState, connectRealtime, type RealtimeEvent } from "@/lib/socket";
import { useMe, useSignedIn } from "@/features/auth/session";
import { ConnectionContext, type Theme, THEME_KEY, ThemeContext } from "./state";

// ---------- Theme ----------

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // ignore
  }
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  const value = useMemo(
    () => ({
      theme,
      setTheme: (t: Theme) => {
        setThemeState(t);
        try {
          localStorage.setItem(THEME_KEY, t);
        } catch {
          // ignore
        }
      },
    }),
    [theme],
  );
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

// ---------- Real time ----------

function plateOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const p = (data as { plate?: unknown }).plate;
  return typeof p === "string" ? p : null;
}

function RealtimeProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const signedIn = useSignedIn();
  const me = useMe();
  const role = me.data?.role;
  const [state, setState] = useState<ConnectionState>("offline");

  useEffect(() => {
    if (!signedIn || !role) return;
    const onEvent = (e: RealtimeEvent) => {
      const plate = plateOf(e.data);
      if (e.type === "alert.created" && role !== "resident") {
        toast.error(`Watchlist plate at the gate${plate ? `: ${formatPlate(plate)}` : ""}`, {
          duration: 15_000,
        });
      }
      if (e.type === "approval.requested" && role === "resident") {
        toast.info("A visitor is waiting at the gate. Approve or deny in Approvals.");
      }
      if (e.type === "escalation.created" && role !== "resident") {
        toast.warning("New call task: a visitor is an hour past the time limit.");
      }
    };
    return connectRealtime(client, onEvent, setState);
  }, [client, signedIn, role]);

  return <ConnectionContext value={signedIn ? state : "offline"}>{children}</ConnectionContext>;
}

export function Providers({ children, client }: { children: ReactNode; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RealtimeProvider>{children}</RealtimeProvider>
        <Toaster position="top-right" richColors closeButton />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
