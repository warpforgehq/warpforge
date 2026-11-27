import { ChevronDown } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useBusy } from "@/hooks/useBusy";
import { type KeeperRunsOn, runsOnLabel, runsOnOptions } from "@/lib/keeperRunsOn";
import { usePickerAgents, usePickerOptions } from "@/lib/pickerPreferences";
import type { AgentConfig, ConfigOption, KeeperDefinition } from "@/protocol";

const SELECT =
  "bg-deep-surface h-7 w-full rounded-md border px-2 text-[13px] outline-none focus:ring-1 focus:ring-ring disabled:opacity-50";

function Choice({
  label,
  value,
  unset,
  option,
  onChange,
}: {
  label: string;
  value: string | undefined;
  unset: string;
  option: ConfigOption | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const choices = option?.options ?? [];
  const extra = value && !choices.some((choice) => choice.value === value) ? [value] : [];
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        aria-label={label}
        className={SELECT}
        value={value ?? ""}
        disabled={choices.length === 0 && extra.length === 0}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">{unset}</option>
        {extra.map((raw) => (
          <option key={raw} value={raw}>
            {raw}
          </option>
        ))}
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * **Runs on**: what a keeper's checker runs on, and a popover that sets its
 * harness, model and effort.
 * @param definition The keeper's parsed definition.
 * @param agents The configured agents.
 * @param onSave Writes the picked values into the keeper file.
 * @returns The trigger and its popover.
 */
export function RunsOnPicker({
  definition,
  agents,
  onSave,
}: {
  definition: KeeperDefinition;
  agents: readonly AgentConfig[];
  onSave: (runsOn: KeeperRunsOn) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, run] = useBusy();
  const [draft, setDraft] = useState<KeeperRunsOn>({});
  const enabled = usePickerAgents(agents);
  const unknown = draft.agent && !enabled.some((agent) => agent.id === draft.agent);
  const configured = agents.find((agent) => agent.id === draft.agent);
  const modelOptions = usePickerOptions(draft.agent, configured?.models);
  const options = runsOnOptions(
    configured ? [{ ...configured, models: modelOptions }] : [],
    draft.agent,
  );
  const label = runsOnLabel(definition, agents);

  const toggle = (next: boolean) => {
    if (next) {
      setDraft({ agent: definition.agent, effort: definition.effort, model: definition.model });
    }
    setOpen(next);
  };
  const save = () =>
    run(async () => {
      await onSave(draft);
      setOpen(false);
    });

  return (
    <Popover.Root open={open} onOpenChange={toggle}>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Runs on"
          aria-label={`Runs on ${label}`}
          className="flex max-w-48 shrink items-center gap-0.5 truncate rounded px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <span className="truncate">{label}</span>
          <ChevronDown aria-hidden className="size-3 shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          aria-label="Runs on"
          className="z-50 flex w-64 flex-col gap-2 rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Harness
            <select
              aria-label="Harness"
              className={SELECT}
              value={draft.agent ?? ""}
              onChange={(event) => setDraft({ agent: event.target.value || undefined })}
            >
              <option value="">Task's agent</option>
              {unknown && (
                <option disabled value={draft.agent}>
                  {draft.agent}
                </option>
              )}
              {enabled.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.displayName}
                </option>
              ))}
            </select>
          </label>
          {draft.agent && (
            <Choice
              label="Model"
              unset="Default"
              value={draft.model}
              option={options.model}
              onChange={(model) => setDraft({ ...draft, model })}
            />
          )}
          {draft.agent && !options.model && (
            <p className="text-xs text-muted-foreground">
              Start this harness once to load its models.
            </p>
          )}
          {draft.agent && (options.effort || draft.effort) && (
            <Choice
              label="Effort"
              unset="Default"
              value={draft.effort}
              option={options.effort}
              onChange={(effort) => setDraft({ ...draft, effort })}
            />
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
