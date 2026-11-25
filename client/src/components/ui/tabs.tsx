// Tabs on Radix (arrow keys move between tabs) + a plain styled table.
import { Tabs as T } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  return (
    <T.List
      className={cn("inline-flex gap-1 rounded-lg border border-border bg-muted p-1", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-border px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return (
    <td className={cn("border-b border-border px-4 py-2.5 align-middle", className)} {...props} />
  );
}
