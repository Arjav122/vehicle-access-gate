// Sign in with email + password. In demo mode (GET /api/demo answers) three big buttons sign
// in as the demo guard, resident or admin in one click. `?role=guard` (from the landing page)
// signs straight in as that demo role.
import { Home, Loader2, Shield, UserCog } from "lucide-react";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { Brand } from "@/app/layouts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { errorMessage } from "@/lib/api";
import { HOME, type Role, useDemo, useMe, useSignedIn, useSignIn } from "./session";

const ROLE_ICON = { guard: Shield, resident: Home, admin: UserCog } as const;

/** Only same-app paths, never `//evil.example` (open redirect). */
function safeNext(next: string | null, role: Role): string {
  if (next?.startsWith("/") && !next.startsWith("//")) {
    const area = next.split("/")[1];
    const allowed = role === "admin" ? ["admin", "guard"] : [role];
    if (area && allowed.includes(area)) return next;
  }
  return HOME[role];
}

export default function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const signedIn = useSignedIn();
  const me = useMe();
  const demo = useDemo();
  const signIn = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const autoRole = params.get("role");
  const tried = useRef(false);

  const go = (role: Role) => {
    void navigate(safeNext(params.get("next"), role), { replace: true });
  };

  const submit = (input: { email: string; password: string }) => {
    signIn.mutate(input, {
      onSuccess: (user) => {
        go(user.role);
      },
    });
  };

  // One click from the landing page: /login?role=guard
  useEffect(() => {
    if (tried.current || !demo.data || !autoRole) return;
    const account = demo.data.accounts.find((a) => a.role === autoRole);
    if (!account) return;
    tried.current = true;
    signIn.mutate(
      { email: account.email, password: demo.data.password },
      {
        onSuccess: (user) => {
          void navigate(HOME[user.role], { replace: true });
        },
      },
    );
  }, [demo.data, autoRole, signIn, navigate]);

  if (signedIn && me.data && !signIn.isPending && !autoRole) {
    return <Navigate to={safeNext(params.get("next"), me.data.role)} replace />;
  }

  const onSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    submit({ email: email.trim(), password });
  };

  return (
    <main className="grid min-h-screen place-items-center bg-surface p-4">
      <div className="grid w-full max-w-md gap-6">
        <div className="flex justify-center">
          <Brand />
        </div>
        <Card className="grid gap-5 p-6">
          <div>
            <h1 className="text-lg font-semibold">Sign in</h1>
            <p className="text-sm text-muted-foreground">
              Guards, residents and the society office use the same sign-in.
            </p>
          </div>

          {demo.data ? (
            <div className="grid gap-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Try the demo: {demo.data.society}
              </p>
              {demo.data.accounts.map((a) => {
                const Icon = ROLE_ICON[a.role];
                return (
                  <Button
                    key={a.role}
                    size="lg"
                    className="justify-start"
                    disabled={signIn.isPending}
                    onClick={() => {
                      submit({ email: a.email, password: demo.data?.password ?? "" });
                    }}
                  >
                    <Icon aria-hidden />
                    <span className="flex flex-col items-start leading-tight">
                      <span>Continue as {a.role}</span>
                      <span className="text-xs font-normal text-muted-foreground">{a.label}</span>
                    </span>
                  </Button>
                );
              })}
              <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or with email
                <span className="h-px flex-1 bg-border" />
              </div>
            </div>
          ) : null}

          <form className="grid gap-4" onSubmit={onSubmit} noValidate>
            <Field label="Email">
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                  }}
                />
              )}
            </Field>
            <Field label="Password">
              {(p) => (
                <Input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                  }}
                />
              )}
            </Field>
            {signIn.isError ? (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(signIn.error)}
              </p>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={signIn.isPending || !email || !password}
            >
              {signIn.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Sign in
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
