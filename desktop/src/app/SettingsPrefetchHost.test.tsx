import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LANGUAGE_SERVERS_QUERY_KEY } from "@/components/LanguageServersPanel";
import { agentUpdatesQueryKey } from "@/hooks/useAgentUpdates";

const { daemonState, detectAgents, detectLanguageServers } = vi.hoisted(() => ({
  daemonState: { connection: "connected" as string },
  detectAgents: vi.fn<() => Promise<never[]>>(async () => []),
  detectLanguageServers: vi.fn<() => Promise<never[]>>(async () => []),
}));

vi.mock("@/daemon", () => ({
  daemon: {
    detectAgents,
    detectLanguageServers,
    getState: () => daemonState,
    subscribe: () => () => {},
  },
}));

import { SettingsPrefetchHost } from "./hosts";

function renderHost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SettingsPrefetchHost />
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => {
  vi.clearAllMocks();
  daemonState.connection = "connected";
});

describe("SettingsPrefetchHost", () => {
  it("warms both Settings detections on idle once the daemon is connected", async () => {
    renderHost();

    await waitFor(() => expect(detectLanguageServers).toHaveBeenCalledTimes(1));
    expect(detectAgents).toHaveBeenCalledTimes(1);
  });

  it("skips a settings query whose key is already cached", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(LANGUAGE_SERVERS_QUERY_KEY, []);
    client.setQueryData(agentUpdatesQueryKey, []);
    render(
      <QueryClientProvider client={client}>
        <SettingsPrefetchHost />
      </QueryClientProvider>,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(detectLanguageServers).not.toHaveBeenCalled();
    expect(detectAgents).not.toHaveBeenCalled();
  });

  it("stays idle while the daemon is still connecting", async () => {
    daemonState.connection = "connecting";
    renderHost();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(detectLanguageServers).not.toHaveBeenCalled();
    expect(detectAgents).not.toHaveBeenCalled();
  });
});
