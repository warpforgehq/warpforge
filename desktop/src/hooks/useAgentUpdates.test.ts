import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentConfig, DetectedAgent } from "@/protocol";
import { useAgentUpdateDismissal } from "@/store/agentUpdates";

const { daemonState, detectAgents } = vi.hoisted(() => ({
  daemonState: { connection: "connected", snapshot: {} as { agents?: AgentConfig[] } },
  detectAgents: vi.fn<() => Promise<DetectedAgent[]>>(),
}));

vi.mock("@/daemon", () => ({
  daemon: {
    detectAgents,
    getState: () => daemonState,
    subscribe: () => () => {},
  },
}));

import { pendingAgentUpdates, useAgentUpdates, useAgentUpdatesCount } from "./useAgentUpdates";

const agent = (id: string, status: string): DetectedAgent => ({
  canManage: true,
  canReinstall: true,
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
  daemonState.snapshot = {};
  useAgentUpdateDismissal.setState({ dismissed: [] });
});

describe("pendingAgentUpdates", () => {
  const behind = (id: string) => ({ ...agent(id, "behind"), latestVersion: "2.0.0" });
  const config = (id: string, enabled: boolean) =>
    ({ id, displayName: id, acpCommand: id, enabled, models: [] }) satisfies AgentConfig;

  it("lists only the agents the daemon reports as behind", () => {
    expect(pendingAgentUpdates(undefined, undefined)).toEqual([]);
    expect(
      pendingAgentUpdates(
        [
          behind("claude"),
          agent("codex", "current"),
          behind("copilot"),
          agent("gemini", "missing"),
        ],
        undefined,
      ),
    ).toEqual(["claude@2.0.0", "copilot@2.0.0"]);
  });

  it("skips agents that are not enabled", () => {
    expect(
      pendingAgentUpdates(
        [behind("claude"), behind("qwen"), behind("goose")],
        [config("claude", true), config("qwen", false)],
      ),
    ).toEqual(["claude@2.0.0"]);
  });
});

describe("useAgentUpdatesCount", () => {
  it("hides a dismissed update until a newer version ships", async () => {
    detectAgents.mockResolvedValue([{ ...agent("claude", "behind"), latestVersion: "2.0.0" }]);
    useAgentUpdateDismissal.setState({ dismissed: ["claude@2.0.0"] });
    const { result } = renderHook(() => useAgentUpdatesCount(), { wrapper: wrapper() });
    await waitFor(() => expect(detectAgents).toHaveBeenCalled());
    expect(result.current).toBe(0);

    detectAgents.mockResolvedValue([{ ...agent("claude", "behind"), latestVersion: "2.1.0" }]);
    const next = renderHook(() => useAgentUpdatesCount(), { wrapper: wrapper() });
    await waitFor(() => expect(next.result.current).toBe(1));
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
