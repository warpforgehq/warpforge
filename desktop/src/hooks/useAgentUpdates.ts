/**
 * Agent CLI versions, polled app-wide instead of only while Settings → Agents
 * is open. Detection is an on-demand daemon read (it shells out to npm), so it
 * belongs in React Query rather than the push store; one shared key keeps the
 * sidebar banner, the collapsed rail and the Agents panel on a single RPC.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { daemon } from "@/daemon";
import type { DetectedAgent } from "@/protocol";

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

/** How many installed agents the daemon reports as out of date. */
export function agentUpdateCount(agents: DetectedAgent[] | undefined): number {
  if (!agents) return 0;
  return agents.reduce((count, agent) => (agent.status === "behind" ? count + 1 : count), 0);
}

/** The badge's number. Same query key as `useAgentUpdates`, so every extra
 *  caller reads the cache instead of starting a second poll. */
export function useAgentUpdatesCount(): number {
  return agentUpdateCount(useAgentUpdates().data);
}
