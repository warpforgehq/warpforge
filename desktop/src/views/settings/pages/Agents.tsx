import { useSyncExternalStore } from "react";

import AccountsPanel from "@/components/AccountsPanel";
import AgentSetupPanel from "@/components/AgentSetupPanel";
import { daemon } from "@/daemon";

import { SettingsPage, SettingsSection } from "../primitives";
import { AgentDefaults } from "./AgentDefaults";

export default function AgentsPage() {
  const { snapshot } = useSyncExternalStore(daemon.subscribe, daemon.getState);

  return (
    <SettingsPage page="agents">
      <AgentDefaults agents={snapshot.agents} />
      <SettingsSection id="agent-setup" title="Agents">
        <AgentSetupPanel pickerVisibility />
      </SettingsSection>
      <SettingsSection id="accounts" title="Accounts & usage">
        <AccountsPanel />
      </SettingsSection>
    </SettingsPage>
  );
}
