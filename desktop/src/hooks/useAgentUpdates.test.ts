import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DetectedAgent } from "@/protocol";

const { daemonState, detectAgents } = vi.hoisted(() => ({
  daemonState: { connection: "connected" },
  detectAgents: vi.fn<() => Promise<DetectedAgent[]>>(),
}));

vi.mock("@/daemon", () => ({
  daemon: {
    detectAgents,
    getState: () => daemonState,
    subscribe: () => () => {},
  },
}));

import { agentUpdateCount, useAgentUpdates, useAgentUpdatesCount } from "./useAgentUpdates";

const agent = (id: string, status: string): DetectedAgent => ({
  canManage: true,
  defaultAcpCommand: `acp-${id}`,
  displayName: id,
  id,
  installHint: "",
  installed: true,
  status,
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  vi.clearAllMocks();
  daemonState.connection = "connected";
});

describe("agentUpdateCount", () => {
  it("counts only the agents the daemon reports as behind", () => {
    expect(agentUpdateCount(undefined)).toBe(0);
    expect(
      agentUpdateCount([
        agent("claude", "behind"),
        agent("codex", "current"),
        agent("copilot", "behind"),
        agent("gemini", "missing"),
      ]),
    ).toBe(2);
  });
});

describe("useAgentUpdates", () => {
  it("detects agents while the daemon is connected", async () => {
    detectAgents.mockResolvedValue([agent("claude", "behind")]);
    const { result } = renderHook(() => useAgentUpdates(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(detectAgents).toHaveBeenCalledTimes(1);
  });

  it("asks nothing of a disconnected daemon", async () => {
    daemonState.connection = "disconnected";
    const { result } = renderHook(() => useAgentUpdates(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(detectAgents).not.toHaveBeenCalled();
  });

  it("shares one RPC between the query and the count", async () => {
    detectAgents.mockResolvedValue([agent("claude", "behind"), agent("codex", "current")]);
    const { result } = renderHook(
      () => ({ count: useAgentUpdatesCount(), query: useAgentUpdates() }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.count).toBe(1));
    expect(detectAgents).toHaveBeenCalledTimes(1);
  });
});
