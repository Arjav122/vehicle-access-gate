// Status badges: colour means state, and every badge carries a word and an icon too
// (brief §12: never colour alone).
import {
  AlertOctagon,
  Ban,
  CheckCircle2,
  Clock,
  DoorOpen,
  HelpCircle,
  Home,
  LogOut,
  ShieldAlert,
  Ticket,
  TimerOff,
  UserPlus,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge, type Tone } from "@/components/ui/card";
import type { Schemas } from "@/lib/api";

type VisitStatus = Schemas["Visit"]["status"];
type MatchResult = Schemas["GateEvent"]["matchResult"];

const VISIT: Record<VisitStatus, { label: string; tone: Tone; icon: ReactNode }> = {
  pending_approval: { label: "Waiting for resident", tone: "info", icon: <Clock /> },
  approved: { label: "Approved", tone: "ok", icon: <CheckCircle2 /> },
  denied: { label: "Denied", tone: "danger", icon: <Ban /> },
  expired: { label: "Expired", tone: "neutral", icon: <TimerOff /> },
  inside: { label: "Inside", tone: "ok", icon: <DoorOpen /> },
  overstayed: { label: "Overstayed", tone: "warn", icon: <Clock /> },
  escalated: { label: "Escalated", tone: "danger", icon: <AlertOctagon /> },
  exited: { label: "Left", tone: "neutral", icon: <LogOut /> },
};

export function VisitStatusBadge({ status }: { status: VisitStatus }) {
  const s = VISIT[status];
  return (
    <Badge tone={s.tone}>
      {s.icon}
      {s.label}
    </Badge>
  );
}

const MATCH: Record<MatchResult, { label: string; tone: Tone; icon: ReactNode }> = {
  resident: { label: "Resident", tone: "ok", icon: <Home /> },
  visitor: { label: "Expected visitor", tone: "ok", icon: <CheckCircle2 /> },
  guest_pass: { label: "Guest pass", tone: "ok", icon: <Ticket /> },
  watchlist: { label: "Watchlist", tone: "danger", icon: <ShieldAlert /> },
  low_confidence: { label: "Unclear read", tone: "warn", icon: <HelpCircle /> },
  ambiguous: { label: "Two close matches", tone: "warn", icon: <HelpCircle /> },
  unknown: { label: "New car", tone: "info", icon: <UserPlus /> },
};

export function MatchBadge({ result }: { result: MatchResult }) {
  const m = MATCH[result];
  return (
    <Badge tone={m.tone}>
      {m.icon}
      {m.label}
    </Badge>
  );
}
