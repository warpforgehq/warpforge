import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import { configRole } from "@/lib/configRole";
import { modelOptionsForPicker } from "@/lib/pickerPreferences";
import { useUi } from "@/store/ui";
import { agentModelIds } from "@/store/ui/devicePreferences";

import {
  SettingsBadge,
  settingsControl,
  SettingsNote,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  Toggle,
} from "../primitives";

export default function ModelsPage() {
  const { snapshot } = useSyncExternalStore(daemon.subscribe, daemon.getState);
  const preferences = useUi((state) => state.pickers);
  const setCustomModel = useUi((state) => state.setCustomModel);
  const setModelHidden = useUi((state) => state.setModelHidden);
  const [selectedId, setSelectedId] = useState("");
  const [input, setInput] = useState("");
  const agents = snapshot.agents ?? [];
  const agent = agents.find((item) => item.id === selectedId) ?? agents[0];
  const agentId = agent?.id ?? "";

  const models = agent
    ? (modelOptionsForPicker(agent.models, agentId, preferences, true).find(
        (option) => configRole(option) === "model",
      )?.options ?? [])
    : [];
  const custom = new Set(agentModelIds(preferences.customModels, agentId));
  const hidden = new Set(agentModelIds(preferences.hiddenModels, agentId));
  const modelId = input.trim();
  const exists = models.some((model) => model.value === modelId);

  return (
    <SettingsPage page="models">
      <SettingsSection title="Agent">
        <SettingsRow
          id="model-agent"
          title="Model list by agent"
          description="Choose the agent whose model list you want to edit."
          control={
            <select
              aria-label="Model list by agent"
              value={agentId}
              disabled={!agent}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setInput("");
              }}
              className={settingsControl}
            >
              {!agent && <option value="">No agents configured</option>}
              {agents.map(({ id, displayName }) => (
                <option key={id} value={id}>
                  {displayName}
                </option>
              ))}
            </select>
          }
        />
        <SettingsRow
          id="custom-models"
          title="Custom model IDs"
          description="Add an exact model ID that your agent can run."
          control={
            <form
              className="flex max-w-full items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!agent || !modelId || exists) return;
                setCustomModel(agentId, modelId, true);
                setInput("");
              }}
            >
              <input
                aria-label="Custom model ID"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="provider/model"
                disabled={!agent}
                className={`${settingsControl} w-44`}
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={!agent || !modelId || exists}
              >
                Add
              </Button>
            </form>
          }
        />
      </SettingsSection>
      <SettingsSection id="visible-models" title="Models in pickers">
        {models.map(({ value, name }) => (
          <SettingsRow
            key={value}
            title={name}
            meta={custom.has(value) && <SettingsBadge>custom</SettingsBadge>}
            description={value === name ? undefined : <span className="font-mono">{value}</span>}
            control={
              <>
                {custom.has(value) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    aria-label={`Remove ${value}`}
                    onClick={() => setCustomModel(agentId, value, false)}
                  >
                    Remove
                  </Button>
                )}
                <Toggle
                  id={`show-model-${encodeURIComponent(value)}`}
                  label={`Show ${value} in model pickers`}
                  checked={!hidden.has(value)}
                  onChange={(shown) => setModelHidden(agentId, value, !shown)}
                />
              </>
            }
          />
        ))}
        {!models.length && <SettingsNote>No models available for this agent.</SettingsNote>}
      </SettingsSection>
    </SettingsPage>
  );
}
