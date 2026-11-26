/**
 * Agent CLI versions, polled app-wide instead of only while Settings → Agents
 * is open. Detection is an on-demand daemon read (it shells out to npm), so it
 * belongs in React Query rather than the push store; one shared key keeps the
 * sidebar banner, the rail and the Agents panel on a single RPC.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { daemon } from "@/daemon";
import type { AgentConfig, DetectedAgent } from "@/protocol";
import { useAgentUpdateDismissal } from "@/store/agentUpdates";

/** Twice a day — an agent release is worth noticing, not worth chasing. */
export const AGENT_UPDATE_POLL_MS = 12 * 60 * 60 * 1000;

export const agentUpdatesQueryKey = ["agents", "detect"] as const;

const getConnection = () => daemon.getState().connection;

export function useAgentUpdates(): UseQueryResult<DetectedAgent[]> {
  const connection = useSyncExternalStore(daemon.subscribe, getConnection);
  return useQuery({
    queryKey: agentUpdatesQueryKey,
    queryFn: () => daemon.detectAgents(),
    enabled: connection === "connected",
    staleTime: AGENT_UPDATE_POLL_MS - 5_000,
    refetchInterval: AGENT_UPDATE_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/**
 * `id@latestVersion` for each out-of-date agent the user has enabled. With no
 * saved agent config yet, every agent counts.
 * @param agents Detected agents, or undefined before the first detection.
 * @param configured Saved agent config from the daemon snapshot.
 * @returns One key per pending update.
 */
export function pendingAgentUpdates(
  agents: DetectedAgent[] | undefined,
  configured: AgentConfig[] | undefined,
): string[] {
  if (!agents) return [];
  const enabled = configured ? new Set(configured.filter((a) => a.enabled).map((a) => a.id)) : null;
  return agents
    .filter((agent) => agent.status === "behind" && (!enabled || enabled.has(agent.id)))
    .map((agent) => `${agent.id}@${agent.latestVersion ?? ""}`);
}

const getConfiguredAgents = () => daemon.getState().snapshot.agents;

/** Pending updates for enabled agents, minus the ones the user dismissed.
 *  Same query key as `useAgentUpdates`, so every extra caller reads the cache. */
export function useAgentUpdateKeys(): string[] {
  const agents = useAgentUpdates().data;
  const configured = useSyncExternalStore(daemon.subscribe, getConfiguredAgents);
  const dismissed = useAgentUpdateDismissal((state) => state.dismissed);
  return pendingAgentUpdates(agents, configured).filter((key) => !dismissed.includes(key));
}

/** The badge's number. */
export function useAgentUpdatesCount(): number {
  return useAgentUpdateKeys().length;
}
