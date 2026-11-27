import { ChevronRight, Plus, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import { isLocalPath } from "@/lib/projectConfig/view";
import { cn } from "@/lib/utils";
import type { EffectiveProjectConfig, ServiceInfo } from "@/protocol";
import {
  SettingsBadge,
  settingsControl,
  SettingsNote,
  SettingsSection,
} from "@/views/settings/primitives";

import { clearEdits, localEdge, OnlyMeBadge, setEdits } from "./fields";
import { ServiceEditor } from "./ServiceEditor";
import type { ConfigEdit } from "./useProjectConfig";

interface Props {
  project: string;
  view: EffectiveProjectConfig;
  runtime: ServiceInfo[];
  edit: (edits: ConfigEdit[]) => void;
  readOnly: boolean;
}

/**
 * Restart a service so it picks up saved config.
 * @param project the project name
 * @param service the service name
 */
export function restartService(project: string, service: string) {
  daemon
    .request("service.restart", { project, service })
    .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)));
}

/** The services list of the Config page. */
export function ServicesSection({ project, view, runtime, edit, readOnly }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const names = Object.keys(view.services).sort();
  const removingLive = runtime.some(
    (service) => service.name === removing && service.status !== "stopped",
  );

  return (
    <SettingsSection id="config-services" title="Services">
      {names.length === 0 && <SettingsNote>No services yet.</SettingsNote>}
      {names.map((name) => {
        const service = view.services[name]!;
        const live = runtime.find((candidate) => candidate.name === name);
        const expanded = open === name;
        const local = isLocalPath(view.localFields, ["services", name]);
        return (
          <div key={name}>
            <div className={cn("flex items-center gap-2 py-2.5 pl-3 pr-3.5", localEdge(local))}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : name)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <ChevronRight
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    expanded && "rotate-90",
                  )}
                />
                <span
                  title={name}
                  className="max-w-[12rem] shrink-0 truncate whitespace-nowrap text-[0.8125rem] font-medium text-foreground"
                >
                  {name}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[0.75rem] text-muted-foreground">
                  {service.command}
                </span>
              </button>
              {local && <OnlyMeBadge />}
              {live?.needsRestart && (
                <>
                  <SettingsBadge tone="warn">Restart to apply</SettingsBadge>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1"
                    onClick={() => restartService(project, name)}
                  >
                    <RotateCw className="size-3" />
                    Restart
                  </Button>
                </>
              )}
              {!readOnly && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${name}`}
                  className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setRemoving(name)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
            {expanded && (
              <ServiceEditor
                name={name}
                service={service}
                view={view}
                edit={edit}
                readOnly={readOnly}
              />
            )}
          </div>
        );
      })}
      {!readOnly && (
        <AddService
          taken={names}
          onAdd={(name, command) => {
            edit(setEdits(view, ["services", name], { command }, "shared"));
            setOpen(name);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing}?`}
        description={
          removingLive
            ? `${removing} is running. Saving stops it and removes it from the config.`
            : `Saving removes ${removing} from the config. If it is running then, it stops.`
        }
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) edit(clearEdits(["services", removing]));
          setRemoving(null);
        }}
      />
    </SettingsSection>
  );
}

function AddService({
  taken,
  onAdd,
}: {
  taken: string[];
  onAdd: (name: string, command: string) => void;
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const clean = name.trim();
  const valid = clean.length > 0 && command.trim().length > 0 && !taken.includes(clean);
  return (
    <form
      className="flex items-center gap-2 px-3.5 py-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onAdd(clean, command.trim());
        setName("");
        setCommand("");
      }}
    >
      <input
        aria-label="New service name"
        placeholder="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className={cn(settingsControl, "w-32 shrink-0")}
      />
      <input
        aria-label="New service command"
        placeholder="command, e.g. bun run dev"
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        className={cn(settingsControl, "w-full font-mono text-[0.75rem]")}
      />
      <Button type="submit" size="sm" variant="outline" className="h-8 gap-1" disabled={!valid}>
        <Plus className="size-3.5" />
        Add service
      </Button>
    </form>
  );
}
