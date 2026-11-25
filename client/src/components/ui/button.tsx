// Button: one component, a few variants (cva = "class variance authority").
// `asChild` renders the styles on the child instead (e.g. a router <Link>).
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "border-accent bg-accent text-accent-foreground hover:opacity-90",
        secondary: "border-border bg-background hover:bg-muted",
        ghost: "border-transparent hover:bg-muted",
        danger: "border-danger bg-danger text-white hover:opacity-90 dark:text-background",
        ok: "border-ok bg-ok text-white hover:opacity-90 dark:text-background",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        lg: "h-12 px-5 text-base", // ≥ 44 px touch target (guard console, resident approvals)
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
