import { configRole } from "@/lib/configRole";
import { usePickerAgents } from "@/lib/pickerPreferences";
import type { AgentConfig } from "@/protocol";
import { useUi } from "@/store/ui";

import { settingsControl, SettingsRow, SettingsSection } from "../primitives";

export function AgentDefaults({ agents }: { agents?: AgentConfig[] }) {
  const visible = usePickerAgents(agents);
  const { defaultAgent, defaultModel } = useUi((s) => s.pickers);
  const setDefaultAgent = useUi((s) => s.setDefaultAgent);
  const setDefaultModel = useUi((s) => s.setDefaultModel);
  const selected = visible.find((agent) => agent.id === defaultAgent);
  const models = selected?.models.find((option) => configRole(option) === "model")?.options ?? [];

  return (
    <SettingsSection title="New Task defaults">
      <SettingsRow
        id="default-agent"
        title="Default agent"
        description="Preselect this agent when you open New Task."
        control={
          <select
            aria-label="Default agent"
            value={selected?.id ?? ""}
            onChange={(event) => setDefaultAgent(event.target.value || null)}
            className={settingsControl}
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
      <SettingsRow
        id="default-model"
        title="Default model"
        description="Preselect a model for the default agent."
        control={
          <select
            aria-label="Default model"
            disabled={!selected || !models.length}
            value={models.some((model) => model.value === defaultModel) ? (defaultModel ?? "") : ""}
            onChange={(event) => setDefaultModel(event.target.value || null)}
            className={settingsControl}
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
    </SettingsSection>
  );
}
