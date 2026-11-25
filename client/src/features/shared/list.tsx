// List helpers for admin tables: a debounced search box and Previous / Next paging over the
// API's { items, total, limit, offset } pages.
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";

export const PAGE_SIZE = 20;

export function SearchBox({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
}) {
  return (
    <div className="relative w-full sm:w-72">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        className="pl-9"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </div>
  );
}

export function Pager({
  offset,
  total,
  limit = PAGE_SIZE,
  onChange,
}: {
  offset: number;
  total: number;
  limit?: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit && offset === 0) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">{total} in total</p>;
  }
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="text-muted-foreground">
        {total === 0 ? 0 : offset + 1}–{Math.min(offset + limit, total)} of {total}
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={offset === 0}
          onClick={() => {
            onChange(Math.max(0, offset - limit));
          }}
        >
          Previous
        </Button>
        <Button
          size="sm"
          disabled={offset + limit >= total}
          onClick={() => {
            onChange(offset + limit);
          }}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
