"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getToken } from "@/lib/api";
import { AdminSidebar } from "@/components/layout/admin-sidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
    }
  }, [router, pathname]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminSidebar />
      <div className="flex min-h-screen flex-1 flex-col">{children}</div>
    </div>
  );
}
