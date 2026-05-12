"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  ClipboardCheck,
  ScrollText,
  Bell,
  Sparkles,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { setToken } from "@/lib/api";

const nav = [
  { href: "/residents", label: "Residents", icon: Users },
  { href: "/approvals", label: "Gate approvals", icon: ClipboardCheck },
  { href: "/visitors", label: "Visitors", icon: Users },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/assistant", label: "AI assistant", icon: Sparkles },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-slate-800 bg-slate-950 text-slate-100">
      <div className="border-b border-slate-800 px-5 py-6">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Platform</div>
        <div className="mt-1 text-lg font-semibold text-white">Vehicle Access</div>
        <div className="text-xs text-slate-400">AI management</div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-900 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-slate-800 p-3">
        <button
          type="button"
          onClick={() => {
            setToken(null);
            window.location.href = "/login";
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-slate-900 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
