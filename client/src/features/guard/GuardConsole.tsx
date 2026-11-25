// Guard console: three columns from 1280 px (arrivals · waiting · needs attention), tabs below
// that (only one layout is mounted). Top bar: vehicles inside, and the two common actions (register, guest code).
// /guard?register=<plate>&event=<id> (from the webcam preview page) opens the register form
// prefilled and linked to that camera read.
import { Car, KeyRound, UserPlus } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMediaQuery } from "@/features/shared/hooks";
import { Arrivals } from "./Arrivals";
import { Attention } from "./Attention";
import { useCallTasks, useInside, useOpenAlerts, useReviewQueue } from "./queries";
import { GuestCodeDialog } from "./GuestCodeDialog";
import { type RegisterTarget, RegisterVisitorDialog } from "./RegisterVisitorDialog";
import { Waiting } from "./Waiting";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function InsideCounter() {
  const q = useInside();
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-2">
      <Car className="size-5 text-accent" aria-hidden />
      <div className="leading-tight">
        <p className="text-2xl font-semibold">{q.data ? q.data.total : "–"}</p>
        <p className="text-xs text-muted-foreground">
          vehicles inside
          {q.data
            ? ` (${String(q.data.residentVehicles)} resident, ${String(q.data.visitors.length)} visitor)`
            : ""}
        </p>
      </div>
    </div>
  );
}

function AttentionCount() {
  const alerts = useOpenAlerts().data?.total ?? 0;
  const review = useReviewQueue().data?.total ?? 0;
  const calls = useCallTasks().data?.total ?? 0;
  const n = alerts + review + calls;
  if (!n) return null;
  return (
    <Badge tone={alerts ? "danger" : "warn"} aria-label={`${String(n)} items`}>
      {n}
    </Badge>
  );
}

export default function GuardConsole() {
  const [params, setParams] = useSearchParams();
  const [guestCode, setGuestCode] = useState(false);
  const [manual, setManual] = useState<RegisterTarget | null>(null);
  const wide = useMediaQuery("(min-width: 1280px)");

  // A register link from the webcam preview: ?register=UP16AB1234&event=<uuid>
  const fromLink: RegisterTarget | null = params.has("register")
    ? {
        plate: params.get("register") ?? undefined,
        gateEventId: UUID.test(params.get("event") ?? "")
          ? (params.get("event") ?? undefined)
          : undefined,
      }
    : null;
  const target = manual ?? fromLink;
  const closeRegister = () => {
    setManual(null);
    if (params.has("register")) {
      params.delete("register");
      params.delete("event");
      setParams(params, { replace: true });
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InsideCounter />
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            onClick={() => {
              setGuestCode(true);
            }}
          >
            <KeyRound aria-hidden /> Guest code
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              setManual({});
            }}
          >
            <UserPlus aria-hidden /> Register visitor
          </Button>
        </div>
      </div>

      {wide ? (
        <div className="grid h-[calc(100vh-10rem)] grid-cols-3 gap-3">
          <Arrivals onRegister={setManual} />
          <Waiting />
          <Attention />
        </div>
      ) : (
        <Tabs defaultValue="arrivals" className="grid gap-3">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="arrivals">Arrivals</TabsTrigger>
            <TabsTrigger value="waiting">Waiting</TabsTrigger>
            <TabsTrigger value="attention">
              Attention <AttentionCount />
            </TabsTrigger>
          </TabsList>
          <TabsContent value="arrivals">
            <Arrivals onRegister={setManual} />
          </TabsContent>
          <TabsContent value="waiting">
            <Waiting />
          </TabsContent>
          <TabsContent value="attention">
            <Attention />
          </TabsContent>
        </Tabs>
      )}

      <RegisterVisitorDialog target={target} onClose={closeRegister} />
      <GuestCodeDialog
        open={guestCode}
        onClose={() => {
          setGuestCode(false);
        }}
      />
    </div>
  );
}
