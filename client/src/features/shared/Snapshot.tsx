// A gate event's camera snapshot. It needs the access token, so it is fetched as a blob and
// shown from an object URL (freed when the image leaves the cache).
import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { useEffect } from "react";
import { fetchImageUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/** A gate event's camera snapshot (needs the access token, so it is fetched as a blob). */
export function Snapshot({
  eventId,
  hasSnapshot,
  className,
}: {
  eventId: string;
  hasSnapshot: boolean;
  className?: string;
}) {
  const q = useQuery({
    queryKey: ["snapshot", eventId],
    queryFn: () => fetchImageUrl(`/api/gate-events/${eventId}/snapshot`),
    enabled: hasSnapshot,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
  });
  // Free the object URL when this image leaves the cache.
  useEffect(() => {
    const url = q.data;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [q.data]);

  const box = cn(
    "grid shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground",
    className,
  );
  if (!hasSnapshot || q.isError)
    return (
      <div className={box} title="No camera snapshot">
        <ImageOff className="size-4" aria-hidden />
        <span className="sr-only">No snapshot</span>
      </div>
    );
  if (!q.data) return <div className={cn(box, "animate-pulse")} aria-hidden />;
  return <img src={q.data} alt="Camera snapshot" className={cn(box, "object-cover")} />;
}
