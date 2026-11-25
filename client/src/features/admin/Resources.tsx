// Admin resource tables: flats, residents, vehicles, guards, gates + camera devices, watchlist.
// One generic <ResourceTable> driven by a small config per resource (columns + form fields),
// instead of six near-identical pages. Search, paging, create / edit dialogs (PATCH sends only
// what changed), and a confirmation before delete. The server cleans + validates plates and
// writes the audit log.
import { useQuery } from "@tanstack/react-query";
import { Copy, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { type SubmitEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  ListSkeleton,
} from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { PlateChip } from "@/components/ui/PlateChip";
import { Table, Td, Th } from "@/components/ui/tabs";
import { useAction } from "@/features/shared/hooks";
import { PAGE_SIZE, Pager, SearchBox } from "@/features/shared/list";
import { useDebounced } from "@/features/shared/hooks";
import { apiRequest, errorMessage, type Schemas } from "@/lib/api";
import { formatRelative, humanize, formatPhone } from "@/lib/format";

// ---------- Config types ----------

type Value = string | boolean;
type Values = Record<string, Value>;

interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "select" | "checkbox" | "flat" | "gate";
  options?: { value: string; label: string }[];
  /** Shown only in the create form (e.g. which flat a resident belongs to). */
  createOnly?: boolean;
  /** Shown only when editing (e.g. Active). */
  editOnly?: boolean;
  /** Required when creating. */
  required?: boolean;
  hint?: string;
  upper?: boolean;
}

interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface ResourceConfig<T extends { id: string }> {
  title: string;
  singular: string;
  path: string;
  description?: string;
  searchable?: boolean;
  columns: Column<T>[];
  fields: FieldDef[];
  /** The edit form's starting values. */
  toValues: (row: T) => Values;
  deleteText: (row: T) => { title: string; description: string; confirm: string };
  /** Shows a one-time device key after create / rotate. */
  devices?: boolean;
}

const active = (isActive: boolean) =>
  isActive ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>;

// ---------- Configs ----------

type Flat = Schemas["Flat"];
type Resident = Schemas["Resident"];
type Vehicle = Schemas["Vehicle"];
type Guard = Schemas["Guard"];
type Gate = Schemas["Gate"];
type Device = Schemas["Device"];
type Watch = Schemas["WatchlistEntry"];

const flats: ResourceConfig<Flat> = {
  title: "Flats",
  singular: "flat",
  path: "/api/flats",
  searchable: true,
  columns: [
    { header: "Flat", cell: (f) => <span className="font-medium">{f.label}</span> },
    { header: "Block", cell: (f) => f.block },
    { header: "Floor", cell: (f) => f.floor },
  ],
  fields: [
    { name: "block", label: "Block", required: true, upper: true, hint: "e.g. B" },
    { name: "number", label: "Flat number", required: true, hint: "e.g. 402" },
    { name: "floor", label: "Floor", type: "number", required: true },
  ],
  toValues: (f) => ({ block: f.block, number: f.number, floor: String(f.floor) }),
  deleteText: (f) => ({
    title: `Delete flat ${f.label}?`,
    description: "Only possible while no residents, vehicles or visits refer to it.",
    confirm: "Delete flat",
  }),
};

const RESIDENT_TYPES = ["owner", "tenant", "family"].map((v) => ({ value: v, label: humanize(v) }));

const residents: ResourceConfig<Resident> = {
  title: "Residents",
  singular: "resident",
  path: "/api/residents",
  searchable: true,
  columns: [
    {
      header: "Name",
      cell: (r) => (
        <div>
          <div className="font-medium">{r.user.fullName}</div>
          <div className="text-xs text-muted-foreground">{r.user.email}</div>
        </div>
      ),
    },
    { header: "Flat", cell: (r) => r.flatLabel },
    {
      header: "Type",
      cell: (r) => (
        <span className="flex gap-1">
          <Badge>{humanize(r.residentType)}</Badge>
          {r.isPrimaryContact ? <Badge tone="info">Primary</Badge> : null}
        </span>
      ),
    },
    { header: "Phone", cell: (r) => r.user.phone ?? "–" },
    { header: "Status", cell: (r) => active(r.user.isActive) },
  ],
  fields: [
    { name: "fullName", label: "Full name", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "phone", label: "Mobile", hint: "+919876543210" },
    {
      name: "password",
      label: "Password",
      type: "password",
      required: true,
      hint: "At least 8 characters; blank keeps the current one when editing",
    },
    { name: "flatId", label: "Flat", type: "flat", required: true, createOnly: true },
    {
      name: "residentType",
      label: "Type",
      type: "select",
      options: RESIDENT_TYPES,
      required: true,
    },
    { name: "isPrimaryContact", label: "Primary contact for the flat", type: "checkbox" },
    { name: "isActive", label: "Active", type: "checkbox", editOnly: true },
  ],
  toValues: (r) => ({
    fullName: r.user.fullName,
    email: r.user.email,
    phone: r.user.phone ?? "",
    password: "",
    residentType: r.residentType,
    isPrimaryContact: r.isPrimaryContact,
    isActive: r.user.isActive,
  }),
  deleteText: (r) => ({
    title: `Deactivate ${r.user.fullName}?`,
    description: "They can no longer sign in or approve visitors. Their history is kept.",
    confirm: "Deactivate",
  }),
};

const vehicles: ResourceConfig<Vehicle> = {
  title: "Vehicles",
  singular: "vehicle",
  path: "/api/vehicles",
  searchable: true,
  columns: [
    { header: "Plate", cell: (v) => <PlateChip plate={v.plate} size="sm" /> },
    { header: "Flat", cell: (v) => v.flatLabel },
    {
      header: "Vehicle",
      cell: (v) => (
        <span>
          {v.makeModel ?? humanize(v.vehicleType)}
          {v.colour ? <span className="text-muted-foreground"> · {v.colour}</span> : null}
        </span>
      ),
    },
    { header: "Status", cell: (v) => active(v.isActive) },
  ],
  fields: [
    {
      name: "plate",
      label: "Plate",
      required: true,
      upper: true,
      hint: "Spaces and dashes are fine",
    },
    { name: "flatId", label: "Flat", type: "flat", required: true },
    {
      name: "vehicleType",
      label: "Type",
      type: "select",
      required: true,
      options: [
        { value: "car", label: "Car" },
        { value: "two_wheeler", label: "Two-wheeler" },
      ],
    },
    { name: "makeModel", label: "Make and model" },
    { name: "colour", label: "Colour" },
    { name: "isActive", label: "Active", type: "checkbox", editOnly: true },
  ],
  toValues: (v) => ({
    plate: v.plate,
    flatId: v.flatId,
    vehicleType: v.vehicleType,
    makeModel: v.makeModel ?? "",
    colour: v.colour ?? "",
    isActive: v.isActive,
  }),
  deleteText: (v) => ({
    title: "Delete this vehicle?",
    description: `${v.plate} stops being recognised as a resident car. Past camera reads keep the plate text.`,
    confirm: "Delete vehicle",
  }),
};

const guards: ResourceConfig<Guard> = {
  title: "Guards",
  singular: "guard",
  path: "/api/guards",
  searchable: true,
  columns: [
    {
      header: "Name",
      cell: (g) => (
        <div>
          <div className="font-medium">{g.fullName}</div>
          <div className="text-xs text-muted-foreground">{g.email}</div>
        </div>
      ),
    },
    { header: "Phone", cell: (g) => (g.phone ? formatPhone(g.phone) : "–") },
    { header: "Status", cell: (g) => active(g.isActive) },
  ],
  fields: [
    { name: "fullName", label: "Full name", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "phone", label: "Mobile", hint: "+919876543210" },
    {
      name: "password",
      label: "Password",
      type: "password",
      required: true,
      hint: "At least 8 characters; blank keeps the current one when editing",
    },
    { name: "isActive", label: "Active", type: "checkbox", editOnly: true },
  ],
  toValues: (g) => ({
    fullName: g.fullName,
    email: g.email,
    phone: g.phone ?? "",
    password: "",
    isActive: g.isActive,
  }),
  deleteText: (g) => ({
    title: `Deactivate ${g.fullName}?`,
    description: "They can no longer sign in. Their past actions stay in the records.",
    confirm: "Deactivate",
  }),
};

const gates: ResourceConfig<Gate> = {
  title: "Gates",
  singular: "gate",
  path: "/api/gates",
  columns: [
    { header: "Gate", cell: (g) => <span className="font-medium">{g.name}</span> },
    { header: "Status", cell: (g) => active(g.isActive) },
  ],
  fields: [
    { name: "name", label: "Name", required: true },
    { name: "isActive", label: "Active", type: "checkbox", editOnly: true },
  ],
  toValues: (g) => ({ name: g.name, isActive: g.isActive }),
  deleteText: (g) => ({
    title: `Delete ${g.name}?`,
    description: "Only possible while no cameras or gate events refer to it.",
    confirm: "Delete gate",
  }),
};

const devices: ResourceConfig<Device> = {
  title: "Camera devices",
  singular: "camera",
  path: "/api/devices",
  description: "Each lane has its own camera key. Keys are shown once.",
  devices: true,
  columns: [
    {
      header: "Camera",
      cell: (d) => (
        <div>
          <div className="font-medium">{d.name}</div>
          <div className="font-mono text-xs text-muted-foreground">{d.apiKeyPrefix}…</div>
        </div>
      ),
    },
    { header: "Gate", cell: (d) => `${d.gateName} · ${d.direction}` },
    {
      header: "Last seen",
      cell: (d) => (d.lastSeenAt ? formatRelative(d.lastSeenAt) : "Never"),
    },
    { header: "Status", cell: (d) => active(d.isActive) },
  ],
  fields: [
    { name: "name", label: "Name", required: true, hint: "e.g. Main gate entry camera" },
    { name: "gateId", label: "Gate", type: "gate", required: true, createOnly: true },
    {
      name: "direction",
      label: "Lane",
      type: "select",
      required: true,
      options: [
        { value: "entry", label: "Entry" },
        { value: "exit", label: "Exit" },
      ],
    },
    { name: "isActive", label: "Active", type: "checkbox", editOnly: true },
  ],
  toValues: (d) => ({ name: d.name, direction: d.direction, isActive: d.isActive }),
  deleteText: (d) => ({
    title: `Delete ${d.name}?`,
    description: "Only possible while no gate events refer to it; otherwise deactivate it.",
    confirm: "Delete camera",
  }),
};

const watchlist: ResourceConfig<Watch> = {
  title: "Watchlist",
  singular: "watchlist plate",
  path: "/api/watchlist",
  description: "These plates raise a red alert on the guard console, even on unclear reads.",
  searchable: true,
  columns: [
    { header: "Plate", cell: (w) => <PlateChip plate={w.plate} size="sm" /> },
    { header: "Reason", cell: (w) => w.reason, className: "max-w-md" },
    { header: "Status", cell: (w) => active(w.isActive) },
  ],
  fields: [
    { name: "plate", label: "Plate", required: true, upper: true },
    { name: "reason", label: "Reason", required: true, hint: "Guards see this in the alert" },
    { name: "isActive", label: "Active", type: "checkbox", editOnly: true },
  ],
  toValues: (w) => ({ plate: w.plate, reason: w.reason, isActive: w.isActive }),
  deleteText: (w) => ({
    title: "Remove from the watchlist?",
    description: `${w.plate} will no longer raise alerts.`,
    confirm: "Remove",
  }),
};

// ---------- Form ----------

function useOptions(path: "/api/flats" | "/api/gates", enabled: boolean) {
  return useQuery({
    queryKey: [path === "/api/flats" ? "flats" : "gates", { all: true }],
    queryFn: () =>
      apiRequest<{ items: { id: string; label?: string; name?: string }[] }>(
        "GET",
        `${path}?limit=100`,
      ),
    enabled,
    staleTime: 60_000,
  });
}

/** Body to send: create → every filled field; edit → only what changed. */
function buildBody(fields: FieldDef[], values: Values, initial: Values | null): Values {
  const body: Values = {};
  for (const f of fields) {
    if (initial ? f.createOnly : f.editOnly) continue;
    let v = values[f.name];
    if (v === undefined) continue;
    if (typeof v === "string") {
      v = v.trim();
      if (f.upper) v = v.toUpperCase();
      if (v === "" && (initial !== null || !f.required)) continue; // blank = leave as is / unset
    }
    if (initial && initial[f.name] === v) continue;
    body[f.name] = v;
  }
  return body;
}

function ResourceForm<T extends { id: string }>({
  config,
  row,
  onDone,
}: {
  config: ResourceConfig<T>;
  row: T | null;
  onDone: (result: unknown) => void;
}) {
  const initial = row ? config.toValues(row) : null;
  const [values, setValues] = useState<Values>(() => {
    if (initial) return initial;
    const v: Values = {};
    for (const f of config.fields)
      v[f.name] = f.type === "checkbox" ? false : (f.options?.[0]?.value ?? "");
    return v;
  });
  const fields = config.fields.filter((f) => (row ? !f.createOnly : !f.editOnly));
  const flatOptions = useOptions(
    "/api/flats",
    fields.some((f) => f.type === "flat"),
  );
  const gateOptions = useOptions(
    "/api/gates",
    fields.some((f) => f.type === "gate"),
  );
  const save = useAction(
    (body: Values) =>
      row
        ? apiRequest("PATCH", `${config.path}/${row.id}`, body)
        : apiRequest("POST", config.path, body),
    {
      success: row ? "Saved" : `${humanize(config.singular)} added`,
      invalidate: [config.path.replace("/api/", ""), "flats", "audit-logs"],
    },
  );
  const missing = row
    ? []
    : fields.filter(
        (f) => f.required && f.type !== "checkbox" && !String(values[f.name] ?? "").trim(),
      );

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body = buildBody(config.fields, values, initial);
    if (row && Object.keys(body).length === 0) {
      onDone(null);
      return;
    }
    save.mutate(body, { onSuccess: onDone });
  };
  const set = (name: string, v: Value) => {
    setValues((old) => ({ ...old, [name]: v }));
  };

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      {fields.map((f) => {
        const v = values[f.name];
        if (f.type === "checkbox") {
          return (
            <label key={f.name} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={v === true}
                onChange={(e) => {
                  set(f.name, e.target.checked);
                }}
              />
              {f.label}
            </label>
          );
        }
        const options =
          f.type === "flat"
            ? (flatOptions.data?.items ?? []).map((o) => ({ value: o.id, label: o.label ?? o.id }))
            : f.type === "gate"
              ? (gateOptions.data?.items ?? []).map((o) => ({ value: o.id, label: o.name ?? o.id }))
              : f.options;
        return (
          <Field key={f.name} label={f.label} {...(f.hint ? { hint: f.hint } : {})}>
            {(p) =>
              options ? (
                <Select
                  {...p}
                  value={String(v ?? "")}
                  onChange={(e) => {
                    set(f.name, e.target.value);
                  }}
                >
                  {f.type === "flat" || f.type === "gate" ? (
                    <option value="">Choose…</option>
                  ) : null}
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  {...p}
                  type={f.type ?? "text"}
                  value={String(v ?? "")}
                  autoComplete={f.type === "password" ? "new-password" : "off"}
                  onChange={(e) => {
                    set(f.name, f.upper ? e.target.value.toUpperCase() : e.target.value);
                  }}
                />
              )
            }
          </Field>
        );
      })}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          onClick={() => {
            onDone(null);
          }}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={save.isPending || missing.length > 0}>
          {row ? "Save changes" : `Add ${config.singular}`}
        </Button>
      </div>
    </form>
  );
}

// ---------- Table ----------

function KeyDialog({ apiKey, onClose }: { apiKey: string | null; onClose: () => void }) {
  return (
    <Dialog
      open={apiKey !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Camera key"
      description="Shown only now. Put it in the camera's ANPR_DEVICE_KEY. It can't be shown again; rotate it to get a new one."
    >
      <div className="grid gap-3">
        <code className="block rounded-md border border-border bg-surface p-3 font-mono text-sm break-all">
          {apiKey}
        </code>
        <Button
          onClick={() => {
            void navigator.clipboard
              .writeText(apiKey ?? "")
              .then(() => toast.success("Key copied"));
          }}
        >
          <Copy aria-hidden /> Copy key
        </Button>
      </div>
    </Dialog>
  );
}

function ResourceTable<T extends { id: string }>({ config }: { config: ResourceConfig<T> }) {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<T | "new" | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const q = useDebounced(search.trim());
  const key = config.path.replace("/api/", "");
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (q) params.set("q", q);
  const list = useQuery({
    queryKey: [key, { q, offset }],
    queryFn: () =>
      apiRequest<{ items: T[]; total: number }>("GET", `${config.path}?${params.toString()}`),
    placeholderData: (prev) => prev,
  });
  const remove = useAction((row: T) => apiRequest("DELETE", `${config.path}/${row.id}`), {
    success: "Done",
    invalidate: [key, "audit-logs"],
  });
  const rotate = useAction(
    (row: T) => apiRequest<{ apiKey: string }>("POST", `${config.path}/${row.id}/rotate-key`),
    { invalidate: [key] },
  );

  return (
    <Card>
      <CardHeader
        title={config.title}
        {...(config.description ? { description: config.description } : {})}
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setEditing("new");
            }}
          >
            <Plus aria-hidden /> Add {config.singular}
          </Button>
        }
      />
      {config.searchable ? (
        <div className="border-b border-border p-3">
          <SearchBox
            label={`Search ${config.title.toLowerCase()}`}
            value={search}
            onChange={(v) => {
              setSearch(v);
              setOffset(0);
            }}
          />
        </div>
      ) : null}
      {list.isPending ? (
        <ListSkeleton rows={5} />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title={q ? "Nothing matches" : `No ${config.title.toLowerCase()} yet`} />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                {config.columns.map((c) => (
                  <Th key={c.header}>{c.header}</Th>
                ))}
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((row) => (
                <tr key={row.id}>
                  {config.columns.map((c) => (
                    <Td key={c.header} className={c.className}>
                      {c.cell(row)}
                    </Td>
                  ))}
                  <Td className="text-right whitespace-nowrap">
                    {config.devices ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Rotate key"
                        title="Rotate key"
                        onClick={() => {
                          rotate.mutate(row, {
                            onSuccess: (r) => {
                              setApiKey(r.apiKey);
                            },
                          });
                        }}
                      >
                        <KeyRound />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit"
                      onClick={() => {
                        setEditing(row);
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={config.deleteText(row).confirm}
                      onClick={() => {
                        setDeleting(row);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager offset={offset} total={list.data.total} onChange={setOffset} />
        </>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        title={editing === "new" ? `Add ${config.singular}` : `Edit ${config.singular}`}
      >
        {editing !== null ? (
          <ResourceForm
            config={config}
            row={editing === "new" ? null : editing}
            onDone={(result) => {
              setEditing(null);
              const k = (result as { apiKey?: unknown } | null)?.apiKey;
              if (config.devices && typeof k === "string") setApiKey(k);
            }}
          />
        ) : null}
      </Dialog>

      {deleting ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setDeleting(null);
          }}
          {...(({ title, description, confirm }) => ({
            title,
            description,
            confirmLabel: confirm,
          }))(config.deleteText(deleting))}
          pending={remove.isPending}
          onConfirm={() => {
            remove.mutate(deleting, {
              onSettled: () => {
                setDeleting(null);
              },
            });
          }}
        />
      ) : null}
      <KeyDialog
        apiKey={apiKey}
        onClose={() => {
          setApiKey(null);
        }}
      />
    </Card>
  );
}

// ---------- Page ----------

export type ResourceKind = "flats" | "residents" | "vehicles" | "guards" | "gates" | "watchlist";

export default function Resources({ kind }: { kind: ResourceKind }) {
  // key: a new page per resource, so search and paging never carry over between tables
  return (
    <div key={kind} className="grid gap-4">
      {kind === "flats" ? <ResourceTable config={flats} /> : null}
      {kind === "residents" ? <ResourceTable config={residents} /> : null}
      {kind === "vehicles" ? <ResourceTable config={vehicles} /> : null}
      {kind === "guards" ? <ResourceTable config={guards} /> : null}
      {kind === "gates" ? (
        <>
          <ResourceTable config={gates} />
          <ResourceTable config={devices} />
        </>
      ) : null}
      {kind === "watchlist" ? <ResourceTable config={watchlist} /> : null}
    </div>
  );
}
