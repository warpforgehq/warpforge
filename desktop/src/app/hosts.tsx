import { useQueryClient } from "@tanstack/react-query";
import { type ComponentProps, useEffect, useSyncExternalStore } from "react";

import { LANGUAGE_SERVERS_QUERY_KEY } from "@/components/LanguageServersPanel";
import Sidebar from "@/components/Sidebar";
import { daemon } from "@/daemon";
import {
  AGENT_UPDATE_POLL_MS,
  agentUpdatesQueryKey,
  useAgentUpdates,
} from "@/hooks/useAgentUpdates";
import { usePrAssistantLifecycle } from "@/hooks/usePrAssistantLifecycle";
import { runOnIdle } from "@/lib/idle";

export const getSnapshot = () => daemon.getState().snapshot;
export const getConnection = () => daemon.getState().connection;
export const getConnectionError = () => daemon.getState().connectionError;
export const getPendingAgentSetup = () => daemon.getState().pendingAgentSetup;

export function LiveSidebar(props: Omit<ComponentProps<typeof Sidebar>, "state">) {
  const state = useSyncExternalStore(daemon.subscribe, daemon.getState);
  return <Sidebar state={state} {...props} />;
}

/**
 * Retires a PR Assistant conversation when its pull request is done with.
 *
 * A component rather than a hook call in `App`: it reads the inbox listing
 * through React Query, and `App` renders above the provider. Every project,
 * because a listing scoped to one says nothing about the others.
 */
export function PrAssistantLifecycleHost({ projects }: { projects: string[] }) {
  usePrAssistantLifecycle(projects);
  return null;
}

/**
 * Owns the agent-package version poll for the whole app, so an out-of-date
 * agent CLI reaches the sidebar dot without anyone opening Settings. A
 * component for the same reason as `PrAssistantLifecycleHost`.
 */
export function AgentUpdatesHost() {
  useAgentUpdates();
  return null;
}

/**
 * Warms the two Settings detections the user would otherwise watch paint a
 * skeleton. Both shell out and take seconds; on idle after the daemon connects,
 * the cache already holds the answer the page will read. Keys already in cache
 * are skipped, and the agent key is the same one `AgentUpdatesHost` polls.
 */
export function SettingsPrefetchHost() {
  const connection = useSyncExternalStore(daemon.subscribe, getConnection);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (connection !== "connected") return;
    return runOnIdle(() => {
      if (queryClient.getQueryData(LANGUAGE_SERVERS_QUERY_KEY) === undefined) {
        void queryClient.prefetchQuery({
          queryKey: LANGUAGE_SERVERS_QUERY_KEY,
          queryFn: () => daemon.detectLanguageServers(),
          staleTime: 5 * 60_000,
        });
      }
      if (queryClient.getQueryData(agentUpdatesQueryKey) === undefined) {
        void queryClient.prefetchQuery({
          queryKey: agentUpdatesQueryKey,
          queryFn: () => daemon.detectAgents(),
          staleTime: AGENT_UPDATE_POLL_MS - 5_000,
        });
      }
    });
  }, [connection, queryClient]);
  return null;
}
