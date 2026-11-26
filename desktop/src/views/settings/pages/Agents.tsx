import { useSyncExternalStore } from "react";

import AccountsPanel from "@/components/AccountsPanel";
import AgentSetupPanel from "@/components/AgentSetupPanel";
import { daemon } from "@/daemon";

import { Section } from "../primitives";
import { AgentDefaults } from "./AgentDefaults";

export default function AgentsPage() {
  const { snapshot } = useSyncExternalStore(daemon.subscribe, daemon.getState);

  return (
    <div className="flex flex-col gap-6">
      <AgentDefaults agents={snapshot.agents} />
      <Section id="agent-setup" title="Agents">
        <AgentSetupPanel />
      </Section>

      <Section id="accounts" title="Accounts & usage">
        <AccountsPanel />
      </Section>
    </div>
  );
}
