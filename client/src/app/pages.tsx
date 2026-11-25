// 404 and the error page every route falls back to (a crash shows this, not a blank screen).
import { Compass, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Button } from "@/components/ui/button";

function Centered({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-surface p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{text}</p>
        {children}
      </div>
    </main>
  );
}

export function NotFoundPage() {
  return (
    <Centered
      icon={<Compass />}
      title="Page not found"
      text="This address doesn't exist in the gate app."
    >
      <Button asChild variant="primary">
        <Link to="/">Go to the start page</Link>
      </Button>
    </Centered>
  );
}

export function ErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  return (
    <Centered
      icon={<TriangleAlert />}
      title="Something went wrong"
      text="The page hit an unexpected error. Reloading usually fixes it; your data is safe on the server."
    >
      <Button
        variant="primary"
        onClick={() => {
          window.location.reload();
        }}
      >
        Reload
      </Button>
    </Centered>
  );
}
