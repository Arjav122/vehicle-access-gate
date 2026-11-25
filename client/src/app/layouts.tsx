// Layouts and route guards: one shell per area.
//   Admin    → sidebar (collapses into a menu on phones)
//   Guard    → dark by default, high contrast, big touch targets
//   Resident → mobile first, bottom tab bar
import {
  Bell,
  Building2,
  Car,
  ClipboardCheck,
  FileClock,
  Gauge,
  Home,
  ListChecks,
  LogOut,
  Mail,
  Menu,
  Moon,
  Settings,
  ShieldAlert,
  Sun,
  Ticket,
  User,
  UserCog,
  Users,
  Video,
} from "lucide-react";
import { type ReactNode, Suspense, useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/card";
import { HOME, type Role, useMe, useSignedIn, useSignOut } from "@/features/auth/session";
import { cn } from "@/lib/utils";
import { useConnection, useTheme } from "./state";

// ---------- Guards ----------

/** Only signed-in users with one of `roles`; others go to /login or to their own area. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const signedIn = useSignedIn();
  const me = useMe();
  const location = useLocation();
  if (!signedIn) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (me.isPending) return <ListSkeleton rows={6} />;
  if (!me.data) return <Navigate to="/login" replace />;
  if (!roles.includes(me.data.role)) return <Navigate to={HOME[me.data.role]} replace />;
  return children;
}

// ---------- Shared bits ----------

export function Brand({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 font-semibold">
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-md bg-accent text-[10px] font-bold text-accent-foreground"
      >
        IND
      </span>
      <span>Green Valley Gate</span>
    </Link>
  );
}

function ConnectionDot() {
  const state = useConnection();
  const label = state === "live" ? "Live" : state === "connecting" ? "Connecting" : "Offline";
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          state === "live" ? "bg-ok" : state === "connecting" ? "bg-warn" : "bg-danger",
        )}
      />
      {label}
    </span>
  );
}

export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: "light" | "dark";
  onChange: (t: "light" | "dark") => void;
}) {
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        onChange(next);
      }}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}

function UserMenu() {
  const me = useMe();
  const signOut = useSignOut();
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-muted-foreground sm:inline">{me.data?.fullName}</span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Sign out"
        onClick={() => {
          signOut();
          void navigate("/login");
        }}
      >
        <LogOut />
      </Button>
    </div>
  );
}

function TopBar({ children, home }: { children?: ReactNode; home: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        {children}
        <Brand to={home} />
      </div>
      <div className="flex items-center gap-2">
        <ConnectionDot />
        <ThemeToggle theme={theme} onChange={setTheme} />
        <UserMenu />
      </div>
    </header>
  );
}

const Loading = () => <ListSkeleton rows={6} />;

// ---------- Admin ----------

const ADMIN_NAV = [
  { to: "/admin", label: "Overview", icon: Gauge, end: true },
  { to: "/admin/visits", label: "Visits", icon: ClipboardCheck },
  { to: "/admin/gate-events", label: "Gate events", icon: Video },
  { to: "/admin/flats", label: "Flats", icon: Building2 },
  { to: "/admin/residents", label: "Residents", icon: Users },
  { to: "/admin/vehicles", label: "Vehicles", icon: Car },
  { to: "/admin/guards", label: "Guards", icon: UserCog },
  { to: "/admin/gates", label: "Gates & cameras", icon: Video },
  { to: "/admin/watchlist", label: "Watchlist", icon: ShieldAlert },
  { to: "/admin/checks", label: "Checks", icon: ListChecks },
  { to: "/admin/notifications", label: "Notifications", icon: Mail },
  { to: "/admin/audit", label: "Audit log", icon: FileClock },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Admin" className="grid gap-0.5 p-3">
      {ADMIN_NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end ?? false}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex h-9 items-center gap-2.5 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4",
              isActive && "bg-muted font-medium text-foreground",
            )
          }
        >
          <Icon aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AdminLayout() {
  // The phone menu remembers the page it was opened on, so navigating closes it.
  const location = useLocation();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === location.pathname;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    setOpenOn(value ? location.pathname : null);
  };
  return (
    <RequireRole roles={["admin"]}>
      <div className="min-h-screen bg-surface">
        <TopBar home="/admin">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => !o);
            }}
          >
            <Menu />
          </Button>
        </TopBar>
        <div className="flex">
          <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r border-border bg-background lg:block">
            <SideNav />
          </aside>
          {open ? (
            <aside className="fixed inset-x-0 top-14 z-20 max-h-[70vh] overflow-y-auto border-b border-border bg-background lg:hidden">
              <SideNav
                onNavigate={() => {
                  setOpen(false);
                }}
              />
            </aside>
          ) : null}
          <main className="min-w-0 flex-1 p-4 sm:p-6">
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </RequireRole>
  );
}

// ---------- Guard ----------

const GUARD_THEME_KEY = "vehicle-access.guard-theme";

/** The guard console has its own theme: dark by default (night shifts, glare at the gate). */
export function GuardLayout() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem(GUARD_THEME_KEY) === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const { theme: appTheme } = useTheme();
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    return () => {
      document.documentElement.classList.toggle("dark", appTheme === "dark");
    };
  }, [theme, appTheme]);
  return (
    <RequireRole roles={["guard", "admin"]}>
      <div className="min-h-screen bg-surface">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background px-4">
          <div className="flex items-center gap-3">
            <Brand to="/guard" />
            <span className="hidden text-sm text-muted-foreground md:inline">Gate console</span>
          </div>
          <div className="flex items-center gap-2">
            <ConnectionDot />
            <ThemeToggle
              theme={theme}
              onChange={(t) => {
                setTheme(t);
                try {
                  localStorage.setItem(GUARD_THEME_KEY, t);
                } catch {
                  // ignore
                }
              }}
            />
            <UserMenu />
          </div>
        </header>
        <main className="p-3 sm:p-4">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </RequireRole>
  );
}

// ---------- Resident ----------

const RESIDENT_NAV = [
  { to: "/resident", label: "Approvals", icon: Bell, end: true },
  { to: "/resident/passes", label: "Guest passes", icon: Ticket },
  { to: "/resident/history", label: "History", icon: Home },
  { to: "/resident/profile", label: "Profile", icon: User },
];

export function ResidentLayout() {
  return (
    <RequireRole roles={["resident"]}>
      <div className="min-h-screen bg-surface pb-20">
        <TopBar home="/resident" />
        <main className="mx-auto w-full max-w-2xl p-4">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
        <nav
          aria-label="Resident"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background"
        >
          <ul className="mx-auto grid max-w-2xl grid-cols-4">
            {RESIDENT_NAV.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end ?? false}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground [&_svg]:size-5",
                      isActive && "font-medium text-accent",
                    )
                  }
                >
                  <Icon aria-hidden />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </RequireRole>
  );
}
