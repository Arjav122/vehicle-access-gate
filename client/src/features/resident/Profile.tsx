// Resident: who am I, which flats, and how notifications reach me.
import { Mail, MessageCircle } from "lucide-react";
import { Badge, Card, CardHeader, ListSkeleton } from "@/components/ui/card";
import { useMe } from "@/features/auth/session";
import { humanize, formatPhone } from "@/lib/format";

export default function Profile() {
  const me = useMe();
  if (!me.data) return <ListSkeleton rows={3} />;
  const u = me.data;
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Profile</h1>
      <Card className="grid gap-1 p-4">
        <p className="text-lg font-semibold">{u.fullName}</p>
        <p className="text-sm text-muted-foreground">{u.email}</p>
        {u.phone ? <p className="text-sm text-muted-foreground">{formatPhone(u.phone)}</p> : null}
      </Card>
      <Card>
        <CardHeader title="Your flats" />
        <ul className="divide-y divide-border">
          {u.flats.map((f) => (
            <li key={f.id} className="flex items-center justify-between p-3">
              <span className="font-medium">{f.label}</span>
              <span className="flex gap-2">
                <Badge>{humanize(f.residentType)}</Badge>
                {f.isPrimaryContact ? <Badge tone="info">Primary contact</Badge> : null}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Notifications" />
        <ul className="grid gap-3 p-4 text-sm">
          <li className="flex gap-3">
            <Mail className="size-4 shrink-0 text-accent" aria-hidden />
            <span>
              Visitor requests appear in this app in real time. Overstay reminders are emailed to{" "}
              <strong>{u.email}</strong>.
            </span>
          </li>
          <li className="flex gap-3 text-muted-foreground">
            <MessageCircle className="size-4 shrink-0" aria-hidden />
            <span>Telegram Approve / Deny buttons are planned (not part of this version yet).</span>
          </li>
        </ul>
      </Card>
    </div>
  );
}
