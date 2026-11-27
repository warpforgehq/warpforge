import { useState } from "react";

import { Button } from "@/components/ui/button";
import { configRole } from "@/lib/configRole";
import { modelOptionsForPicker } from "@/lib/pickerPreferences";
import type { AgentConfig } from "@/protocol";
import { useUi } from "@/store/ui";
import { agentModelIds } from "@/store/ui/devicePreferences";
import { settingsControl, SettingsBadge, Toggle } from "@/views/settings/primitives";

/**
 * An agent's model list, expanded under its row: which models pickers offer,
 * and custom model ids the agent can run.
 */
export function AgentModels({ agent }: { agent: AgentConfig }) {
  const preferences = useUi((state) => state.pickers);
  const setCustomModel = useUi((state) => state.setCustomModel);
  const setModelHidden = useUi((state) => state.setModelHidden);
  const [input, setInput] = useState("");

  const models =
    modelOptionsForPicker(agent.models, agent.id, preferences, true).find(
      (option) => configRole(option) === "model",
    )?.options ?? [];
  const custom = new Set(agentModelIds(preferences.customModels, agent.id));
  const hidden = new Set(agentModelIds(preferences.hiddenModels, agent.id));
  const modelId = input.trim();
  const exists = models.some((model) => model.value === modelId);

  return (
    <div
      role="region"
      aria-label={`${agent.displayName} models`}
      className="bg-foreground/[0.015] pb-2.5 pl-11 pr-3.5"
    >
      {models.length > 0 ? (
        <ul className="divide-y divide-border/40">
          {models.map(({ value, name }) => (
            <li key={value} className="flex min-h-9 items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="text-[0.8125rem] text-foreground">{name}</span>
                {value !== name && (
                  <span className="ml-2 font-mono text-[0.75rem] text-muted-foreground">
                    {value}
                  </span>
                )}
              </span>
              {custom.has(value) && (
                <>
                  <SettingsBadge>custom</SettingsBadge>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    aria-label={`Remove ${value}`}
                    onClick={() => setCustomModel(agent.id, value, false)}
                  >
                    Remove
                  </Button>
                </>
              )}
              <Toggle
                id={`show-model-${agent.id}-${encodeURIComponent(value)}`}
                label={`Show ${value} in model pickers`}
                checked={!hidden.has(value)}
                onChange={(shown) => setModelHidden(agent.id, value, !shown)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-2 text-[0.75rem] text-muted-foreground">
          No models reported yet. Reload the models list or add an id below.
        </p>
      )}
      <form
        className="flex items-center gap-2 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!modelId || exists) return;
          setCustomModel(agent.id, modelId, true);
          setInput("");
        }}
      >
        <input
          aria-label={`Add model id for ${agent.displayName}`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Add model id, e.g. provider/model"
          className={`${settingsControl} w-64`}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!modelId || exists}>
          Add
        </Button>
      </form>
    </div>
  );
}
