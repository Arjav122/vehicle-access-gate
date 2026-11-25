// Landing page: the pitch, what it does, how it works, and one-click demo buttons.
import {
  ArrowRight,
  BellRing,
  Camera,
  Clock,
  Home,
  ScanLine,
  Shield,
  ShieldAlert,
  Ticket,
  UserCog,
} from "lucide-react";
import { Link } from "react-router";
import { Brand } from "@/app/layouts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlateChip } from "@/components/ui/PlateChip";
import { useDemo } from "@/features/auth/session";

const FEATURES = [
  {
    icon: ScanLine,
    title: "Plates read at the gate",
    text: "A camera reads the number plate, votes across frames and sends one read per car. The server fixes O/0 and B/8 mix-ups by position and checks real Indian formats.",
  },
  {
    icon: Home,
    title: "Residents drive straight in",
    text: "A known resident car is logged as entry or exit automatically, and each exit is paired with its entry.",
  },
  {
    icon: BellRing,
    title: "Visitors approved from a phone",
    text: "The guard registers a new car; the resident taps Approve or Deny. No answer in 3 minutes and the guard decides.",
  },
  {
    icon: Ticket,
    title: "Guest passes",
    text: "Residents pre-approve a guest by plate or a one-time code. The car is let in without a call.",
  },
  {
    icon: Clock,
    title: "Overstays followed up",
    text: "Past the time limit the visitor and resident get an email, then a reminder, then the guard gets a task to call.",
  },
  {
    icon: ShieldAlert,
    title: "Watchlist first",
    text: "Banned or reported plates raise a red alert on the guard console, even when the read is unclear.",
  },
];

const FLOW = [
  { icon: Camera, label: "Camera + ANPR worker", sub: "YOLO → OCR → frame voting" },
  { icon: ScanLine, label: "Node API", sub: "repair · match · state machine" },
  { icon: Shield, label: "Guard console", sub: "live arrivals · alerts" },
  { icon: Home, label: "Resident phone", sub: "approve · guest passes" },
];

export default function LandingPage() {
  const demo = useDemo();
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Brand />
        <Button asChild>
          <Link to="/login">Sign in</Link>
        </Button>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.2fr_1fr] md:py-20">
          <div className="grid content-center gap-6">
            <p className="text-sm font-medium text-accent">For Indian housing societies</p>
            <h1 className="text-4xl leading-tight font-semibold tracking-tight md:text-5xl">
              The gate reads the plate. Residents drive in. Visitors get approved from a phone.
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              An AI number-plate reader at the gate, a live console for guards, and a phone app for
              residents. Cars that stay too long are followed up automatically.
            </p>
            {demo.data ? (
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="primary" size="lg">
                  <Link to="/login?role=guard">
                    <Shield aria-hidden /> Try demo as Guard
                  </Link>
                </Button>
                <Button asChild size="lg">
                  <Link to="/login?role=resident">
                    <Home aria-hidden /> as Resident
                  </Link>
                </Button>
                <Button asChild size="lg">
                  <Link to="/login?role=admin">
                    <UserCog aria-hidden /> as Admin
                  </Link>
                </Button>
              </div>
            ) : (
              <Button asChild variant="primary" size="lg" className="w-fit">
                <Link to="/login">
                  Sign in <ArrowRight aria-hidden />
                </Link>
              </Button>
            )}
          </div>

          <Card className="grid content-center gap-4 bg-surface p-6" aria-label="Example arrivals">
            {[
              { plate: "UP16AB1234", text: "Resident car: entry logged", tone: "text-ok" },
              { plate: "22BH4521AA", text: "New car: register the visitor", tone: "text-info" },
              { plate: "DL8CAF7203", text: "Watchlist plate: stop the car", tone: "text-danger" },
            ].map((r) => (
              <div
                key={r.plate}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3"
              >
                <PlateChip plate={r.plate} />
                <span className={`text-sm font-medium ${r.tone}`}>{r.text}</span>
              </div>
            ))}
          </Card>
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <Card key={title} className="grid content-start gap-2 p-5">
                <Icon className="size-5 text-accent" aria-hidden />
                <h2 className="font-semibold">{title}</h2>
                <p className="text-sm text-muted-foreground">{text}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-semibold">How it fits together</h2>
          <p className="mt-1 text-muted-foreground">
            The camera reads; the server decides. All plate repair and matching lives in one place.
          </p>
          <ol className="mt-6 grid gap-3 md:grid-cols-4">
            {FLOW.map(({ icon: Icon, label, sub }, i) => (
              <li key={label} className="relative">
                <Card className="grid h-full gap-1 p-4">
                  <Icon className="size-5 text-accent" aria-hidden />
                  <span className="text-xs text-muted-foreground">Step {i + 1}</span>
                  <span className="font-medium">{label}</span>
                  <span className="text-sm text-muted-foreground">{sub}</span>
                </Card>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-muted-foreground">
            React + Vite · Node.js + Express + Socket.io · PostgreSQL (Prisma) · Python ANPR worker
            (ONNX YOLO11 + PaddleOCR) with an offline buffer.
          </p>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted-foreground">
          Demo society: Green Valley Residency, Greater Noida. All people and plates are made up.
        </div>
      </footer>
    </div>
  );
}
