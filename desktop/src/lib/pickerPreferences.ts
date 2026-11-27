import { useMemo } from "react";

import { configRole } from "@/lib/configRole";
import type { AgentConfig, ConfigOption } from "@/protocol";
import { useUi } from "@/store/ui";
import { agentModelIds, type PickerPreferences } from "@/store/ui/devicePreferences";

const emptyOptions: ConfigOption[] = [];

export function modelOptionsForPicker(
  options: ConfigOption[],
  agent: string,
  preferences: PickerPreferences,
  includeHidden = false,
  allowSynthetic = true,
): ConfigOption[] {
  const stored = agentModelIds(preferences.customModels, agent);
  const hidden = agentModelIds(preferences.hiddenModels, agent);
  if (!stored.length && (includeHidden || !hidden.length)) return options;

  const index = options.findIndex((option) => configRole(option) === "model");
  const model = options[index];
  if (!model && (!stored.length || !allowSynthetic)) return options;

  const choices = new Map(model?.options.map((choice) => [choice.value, choice]));
  for (const id of stored) {
    if (!choices.has(id)) choices.set(id, { value: id, name: id });
  }

  const hiddenChoices = new Set(hidden);
  const merged = {
    ...(model ?? { id: "model", name: "Model", category: "model", currentValue: "" }),
    options: [...choices.values()].filter(
      (choice) => includeHidden || !hiddenChoices.has(choice.value),
    ),
  };
  return model ? options.map((option, i) => (i === index ? merged : option)) : [...options, merged];
}

export function usePickerOptions(
  agent?: string | null,
  options = emptyOptions,
  allowSynthetic = true,
) {
  const preferences = useUi((s) => s.pickers);
  return useMemo(
    () =>
      agent ? modelOptionsForPicker(options, agent, preferences, false, allowSynthetic) : options,
    [agent, options, preferences, allowSynthetic],
  );
}

export function usePickerAgents(agents?: readonly AgentConfig[]) {
  const preferences = useUi((s) => s.pickers);
  return useMemo(() => {
    return (agents ?? [])
      .filter((agent) => agent.enabled)
      .map((agent) => ({
        ...agent,
        models: modelOptionsForPicker(agent.models, agent.id, preferences),
      }));
  }, [agents, preferences]);
}
