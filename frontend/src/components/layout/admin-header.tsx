"use client";

import { Bell } from "lucide-react";

export function AdminHeader({ title }: { title: string }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-200/80 bg-white/95 px-6 shadow-sm backdrop-blur">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Gate & access</p>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-slate-500 sm:inline">Secure session</span>
        <button
          type="button"
          className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 shadow-sm transition hover:bg-slate-50"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
