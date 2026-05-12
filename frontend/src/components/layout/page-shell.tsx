import { AdminHeader } from "@/components/layout/admin-header";

export function PageShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <AdminHeader title={title} />
      <main className="flex-1 overflow-auto bg-slate-50/80 p-6">{children}</main>
    </>
  );
}
