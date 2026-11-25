// PlateChip — the signature element: every vehicle is drawn as a mini Indian HSRP plate.
// White plate, thin black border, blue "IND" strip on the left, condensed bold characters
// grouped as printed (UP16 AB 1234, 22 BH 1234 AA). It stays white in dark mode, like a real
// plate. Screen readers hear "Number plate U P 1 6 A B 1 2 3 4" rather than a mumbled word.
import { cn } from "@/lib/utils";
import { plateGroups } from "@/lib/plates";

export function PlateChip({
  plate,
  size = "md",
  className,
}: {
  plate: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const groups = plateGroups(plate);
  const spoken = groups.join(" ").split("").join(" ").replace(/ {3}/g, ", ");
  return (
    <span
      role="img"
      aria-label={`Number plate ${spoken}`}
      className={cn(
        "inline-flex shrink-0 items-stretch overflow-hidden rounded-[4px] border border-black bg-white text-black select-all",
        size === "sm" && "h-6 text-[13px]",
        size === "md" && "h-8 text-base",
        size === "lg" && "h-12 text-2xl",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex flex-col items-center justify-end bg-[#1f4fb8] font-sans font-bold text-white",
          size === "sm" && "w-3.5 pb-0.5 text-[5px]",
          size === "md" && "w-4.5 pb-0.5 text-[6px]",
          size === "lg" && "w-7 pb-1 text-[9px]",
        )}
      >
        IND
      </span>
      <span
        aria-hidden
        className={cn(
          "font-plate flex items-center font-bold tracking-wide whitespace-nowrap",
          size === "sm" ? "gap-1 px-1.5" : size === "md" ? "gap-1.5 px-2" : "gap-2.5 px-3",
        )}
      >
        {groups.map((g, i) => (
          <span key={i}>{g}</span>
        ))}
      </span>
    </span>
  );
}
