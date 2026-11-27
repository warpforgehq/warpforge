import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { forwardCount, forwardIndex, forwardKey, isLocalPath } from "@/lib/projectConfig/view";
import { cn } from "@/lib/utils";
import type { EffectiveProjectConfig, ProjectConfigForward, ProjectConfigScope } from "@/protocol";
import { settingsControl, SettingsNote, SettingsSection } from "@/views/settings/primitives";

import { DraftInput, OnlyMeBadge, ScopeToggle } from "./fields";
import type { ConfigEdit } from "./useProjectConfig";

export interface ConfigData {
  shared: unknown;
  local: unknown;
}

interface Props {
  view: EffectiveProjectConfig;
  data: ConfigData;
  edit: (edits: ConfigEdit[]) => void;
  readOnly: boolean;
}

type Field = "namespace" | "pod" | "localPort" | "remotePort";
const FIELDS: { id: Field; label: string; numeric?: boolean }[] = [
  { id: "namespace", label: "Namespace" },
  { id: "pod", label: "Pod" },
  { id: "localPort", label: "Local port", numeric: true },
  { id: "remotePort", label: "Remote port", numeric: true },
];

const identity = (forward: ProjectConfigForward) =>
  forward.name ? { name: forward.name } : { namespace: forward.namespace, pod: forward.pod };

const entryOf = (forward: ProjectConfigForward) => ({
  ...identity(forward),
  namespace: forward.namespace,
  pod: forward.pod,
  localPort: forward.localPort,
  remotePort: forward.remotePort,
});

function fieldEdits(
  data: ConfigData,
  forward: ProjectConfigForward,
  field: Field,
  value: string | number,
  target: ProjectConfigScope,
): ConfigEdit[] {
  const key = forwardKey(forward)!;
  const index = forwardIndex(data[target], key);
  if (index >= 0) {
    const edits: ConfigEdit[] = [{ path: ["portforwards", index, field], scope: target, value }];
    const local = forwardIndex(data.local, key);
    if (target === "shared" && local >= 0) {
      edits.push({ path: ["portforwards", local, field], remove: true, scope: "local" });
    }
    return edits;
  }
  const fresh = target === "shared" ? entryOf(forward) : identity(forward);
  return [
    {
      path: ["portforwards", forwardCount(data[target])],
      scope: target,
      value: { ...fresh, [field]: value },
    },
  ];
}

function promoteEdits(data: ConfigData, forward: ProjectConfigForward): ConfigEdit[] {
  const key = forwardKey(forward)!;
  const local = forwardIndex(data.local, key);
  const shared = forwardIndex(data.shared, key);
  const edits: ConfigEdit[] =
    shared >= 0
      ? FIELDS.map(({ id }) => ({
          path: ["portforwards", shared, id],
          scope: "shared",
          value: forward[id],
        }))
      : [
          {
            path: ["portforwards", forwardCount(data.shared)],
            scope: "shared",
            value: entryOf(forward),
          },
        ];
  if (local >= 0) edits.push({ path: ["portforwards", local], remove: true, scope: "local" });
  return edits;
}

function removeEdits(data: ConfigData, forward: ProjectConfigForward): ConfigEdit[] {
  const key = forwardKey(forward)!;
  return (["shared", "local"] as const).flatMap((scope): ConfigEdit[] => {
    const index = forwardIndex(data[scope], key);
    return index >= 0 ? [{ path: ["portforwards", index], remove: true, scope }] : [];
  });
}

/** Port forwards: list, edit, add and remove. */
export function ForwardsSection({ view, data, edit, readOnly }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, ProjectConfigScope>>({});

  return (
    <SettingsSection id="config-forwards" title="Port forwards">
      {view.portforwards.length === 0 && <SettingsNote>No port forwards.</SettingsNote>}
      {view.portforwards.map((forward) => {
        const key = forwardKey(forward) ?? "";
        const local = isLocalPath(view.localFields, ["portforwards", key]);
        const target = local ? "local" : (picked[key] ?? "shared");
        const expanded = open === key;
        return (
          <div key={key}>
            <div className="flex items-center gap-2 px-3.5 py-2.5">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : key)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <ChevronRight
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    expanded && "rotate-90",
                  )}
                />
                <span className="text-[0.8125rem] font-medium text-foreground">{key}</span>
                <span className="min-w-0 truncate font-mono text-[0.75rem] text-muted-foreground">
                  :{forward.localPort} → {forward.pod}:{forward.remotePort}
                </span>
              </button>
              {local && <OnlyMeBadge />}
              <ScopeToggle
                label={`Save ${key} to`}
                value={target}
                disabled={readOnly}
                onChange={(scope) => {
                  setPicked((prev) => ({ ...prev, [key]: scope }));
                  if (scope === "shared" && local) edit(promoteEdits(data, forward));
                }}
              />
              {!readOnly && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${key}`}
                  className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => edit(removeEdits(data, forward))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
            {expanded && (
              <div className="grid grid-cols-2 gap-2 px-3.5 pb-3">
                {FIELDS.map((field) => (
                  <label
                    key={field.id}
                    className="flex flex-col gap-1 text-[0.75rem] text-muted-foreground"
                  >
                    {field.label}
                    <DraftInput
                      label={`${key} ${field.label}`}
                      value={String(forward[field.id])}
                      disabled={readOnly}
                      onCommit={(text) => {
                        const value = field.numeric ? Number(text) : text;
                        if (!text || (field.numeric && !Number.isInteger(value))) return;
                        edit(fieldEdits(data, forward, field.id, value, target));
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {!readOnly && <AddForward data={data} edit={edit} />}
    </SettingsSection>
  );
}

function AddForward({ data, edit }: { data: ConfigData; edit: (edits: ConfigEdit[]) => void }) {
  const empty = { localPort: "", name: "", namespace: "", pod: "", remotePort: "" };
  const [draft, setDraft] = useState(empty);
  const [target, setTarget] = useState<ProjectConfigScope>("shared");
  const localPort = Number(draft.localPort);
  const remotePort = Number(draft.remotePort);
  const valid =
    draft.namespace.trim() &&
    draft.pod.trim() &&
    Number.isInteger(localPort) &&
    localPort > 0 &&
    Number.isInteger(remotePort) &&
    remotePort > 0;
  const input = (field: keyof typeof empty, placeholder: string, className: string) => (
    <input
      aria-label={`New forward ${placeholder}`}
      placeholder={placeholder}
      value={draft[field]}
      onChange={(event) => setDraft((prev) => ({ ...prev, [field]: event.target.value }))}
      className={cn(settingsControl, className)}
    />
  );
  return (
    <form
      className="flex flex-wrap items-center gap-2 px-3.5 py-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        const entry = {
          ...(draft.name.trim() && { name: draft.name.trim() }),
          namespace: draft.namespace.trim(),
          pod: draft.pod.trim(),
          localPort,
          remotePort,
        };
        edit([{ path: ["portforwards", forwardCount(data[target])], scope: target, value: entry }]);
        setDraft(empty);
      }}
    >
      {input("name", "name", "w-24")}
      {input("namespace", "namespace", "w-28")}
      {input("pod", "pod", "min-w-24 flex-1")}
      {input("localPort", "local port", "w-24")}
      {input("remotePort", "remote port", "w-24")}
      <ScopeToggle label="Save new forward to" value={target} onChange={setTarget} />
      <Button type="submit" size="sm" variant="outline" className="h-8 gap-1" disabled={!valid}>
        <Plus className="size-3.5" />
        Add
      </Button>
    </form>
  );
}
