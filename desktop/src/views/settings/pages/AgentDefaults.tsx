import { configRole } from "@/lib/configRole";
import { usePickerAgents } from "@/lib/pickerPreferences";
import type { AgentConfig } from "@/protocol";
import { useUi } from "@/store/ui";

import { Section, SettingRow, settingsSelect, Toggle } from "../primitives";

export function AgentDefaults({ agents }: { agents?: AgentConfig[] }) {
  const visible = usePickerAgents(agents);
  const { defaultAgent, defaultModel, hiddenAgents } = useUi((s) => s.pickers);
  const hidden = new Set(hiddenAgents);
  const setDefaultAgent = useUi((s) => s.setDefaultAgent);
  const setDefaultModel = useUi((s) => s.setDefaultModel);
  const setAgentHidden = useUi((s) => s.setAgentHidden);
  const selected = visible.find((agent) => agent.id === defaultAgent);
  const models = selected?.models.find((option) => configRole(option) === "model")?.options ?? [];

  return (
    <>
      <Section title="New Task defaults">
        <SettingRow
          id="default-agent"
          title="Default agent"
          description="Preselect this agent when you open New Task."
          control={
            <select
              aria-label="Default agent"
              value={selected?.id ?? ""}
              onChange={(event) => setDefaultAgent(event.target.value || null)}
              className={settingsSelect}
            >
              <option value="">First available agent</option>
              {visible.map(({ id, displayName }) => (
                <option key={id} value={id}>
                  {displayName}
                </option>
              ))}
            </select>
          }
        />
        <SettingRow
          id="default-model"
          title="Default model"
          description="Preselect a model for the default agent."
          control={
            <select
              aria-label="Default model"
              disabled={!selected || !models.length}
              value={
                models.some((model) => model.value === defaultModel) ? (defaultModel ?? "") : ""
              }
              onChange={(event) => setDefaultModel(event.target.value || null)}
              className={settingsSelect}
            >
              <option value="">Use agent default</option>
              {models.map(({ value, name }) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          }
        />
      </Section>
      <Section id="visible-agents" title="Agents in pickers">
        {agents?.length ? (
          agents.map(({ id, displayName }) => (
            <SettingRow
              key={id}
              title={displayName}
              description="Show this agent in pickers when enabled."
              control={
                <Toggle
                  id={`show-agent-${id}`}
                  label={`Show ${displayName} in agent pickers`}
                  checked={!hidden.has(id)}
                  onChange={(shown) => setAgentHidden(id, !shown)}
                />
              }
            />
          ))
        ) : (
          <p className="px-3 py-2 text-xs text-muted-foreground">No agents configured.</p>
        )}
      </Section>
    </>
  );
}
