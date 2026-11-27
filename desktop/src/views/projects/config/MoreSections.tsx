import { X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EffectiveProjectConfig } from "@/protocol";
import { useUi } from "@/store/ui";
import { settingsControl, SettingsNote, SettingsSection } from "@/views/settings/primitives";

import { clearEdits, FieldRow, setEdits, TextField, useFieldScope } from "./fields";
import type { ConfigEdit } from "./useProjectConfig";

interface Props {
  view: EffectiveProjectConfig;
  edit: (edits: ConfigEdit[]) => void;
  readOnly: boolean;
}

/** The port range the project's services are allocated from. */
export function PortsSection(props: Props) {
  return (
    <SettingsSection id="config-ports" title="Ports" padded>
      <TextField
        {...props}
        path={["ports", "range"]}
        label="Range"
        hint="Ports this project uses"
        placeholder="e.g. 4100-4199"
        value={props.view.ports?.range ?? null}
      />
    </SettingsSection>
  );
}

/** Files copied into each task worktree, and the command run after. */
export function WorktreeSection(props: Props) {
  const { view, edit, readOnly } = props;
  const copy = view.worktree?.copy ?? [];
  const path = ["worktree", "copy"];
  const scope = useFieldScope(view, path, "shared", copy.length ? copy : undefined, edit);
  const [glob, setGlob] = useState("");
  const write = (next: string[]) =>
    edit(next.length ? setEdits(view, path, next, scope.target) : clearEdits(path));
  return (
    <SettingsSection id="config-worktree" title="Worktree" padded>
      <FieldRow label="Copy" hint="Globs copied into each task" scope={scope} readOnly={readOnly}>
        <div className="flex flex-1 flex-wrap items-center gap-1">
          {copy.map((item) => (
            <span
              key={item}
              className="inline-flex h-6 items-center gap-1 rounded-control border border-border px-2 font-mono text-[0.75rem]"
            >
              {item}
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Remove ${item}`}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => write(copy.filter((other) => other !== item))}
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}
          {!readOnly && (
            <input
              aria-label="Add glob"
              placeholder="e.g. .env*"
              value={glob}
              onChange={(event) => setGlob(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !glob.trim() || copy.includes(glob.trim())) return;
                write([...copy, glob.trim()]);
                setGlob("");
              }}
              className={cn(settingsControl, "w-32 font-mono text-[0.75rem]")}
            />
          )}
        </div>
      </FieldRow>
      <TextField
        {...props}
        path={["worktree", "setup"]}
        label="Setup"
        hint="Runs in each new worktree"
        placeholder="e.g. bun install"
        value={view.worktree?.setup ?? null}
        mono
      />
    </SettingsSection>
  );
}

/** Sibling repos the file links; membership is managed with spaces. */
export function LinkedSection({ linked }: { linked: string[] }) {
  const openSpaces = () => {
    const ui = useUi.getState();
    ui.openSettings();
    ui.setSettingsPage("spaces");
  };
  return (
    <SettingsSection
      id="config-linked"
      title="Linked repos"
      actions={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 text-[0.75rem]"
          onClick={openSpaces}
        >
          Manage in Spaces & repos
        </Button>
      }
    >
      {linked.length === 0 ? (
        <SettingsNote>No linked repos.</SettingsNote>
      ) : (
        linked.map((path) => (
          <div key={path} className="truncate px-3.5 py-2 font-mono text-[0.75rem]" title={path}>
            {path}
          </div>
        ))
      )}
    </SettingsSection>
  );
}
