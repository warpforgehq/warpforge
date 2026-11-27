import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render as renderBare, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren, ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InstallAgentResult } from "@/daemon/agents";
import { DaemonRpcError } from "@/daemon/rpcError";
import { agentUpdatesQueryKey } from "@/hooks/useAgentUpdates";
import type { DaemonEvent, DetectedAgent } from "@/protocol";
import { useUi } from "@/store/ui";

const { daemonState, detectAgents, installAgent, probeAgent, saveAgents, store } = vi.hoisted(
  () => {
    const initial = { snapshot: { agents: [] as unknown[] } };
    return {
      daemonState: initial,
      store: {
        state: initial as typeof initial & { agentHealth?: Record<string, unknown> },
        listeners: new Set<() => void>(),
        eventListeners: new Set<(event: DaemonEvent) => void>(),
      },
      detectAgents: vi.fn<() => Promise<DetectedAgent[]>>(),
      installAgent: vi.fn<(id: string, clean?: boolean) => Promise<InstallAgentResult>>(),
      probeAgent: vi.fn<(id: string) => Promise<void>>(),
      saveAgents: vi.fn<() => Promise<void>>(),
    };
  },
);

vi.mock("@/daemon", () => ({
  daemon: {
    detectAgents,
    installAgent,
    probeAgent,
    saveAgents,
    // The panel seeds its rows from the configured-agent snapshot. getState must
    // return a stable reference or useSyncExternalStore re-renders forever.
    subscribe: (fn: () => void) => {
      store.listeners.add(fn);
      return () => store.listeners.delete(fn);
    },
    subscribeEvents: (fn: (event: DaemonEvent) => void) => {
      store.eventListeners.add(fn);
      return () => store.eventListeners.delete(fn);
    },
    getState: () => store.state,
  },
}));

import AgentSetupPanel from "./AgentSetupPanel";

const agent = (id: string, overrides: Partial<DetectedAgent> = {}): DetectedAgent => ({
  canManage: true,
  canReinstall: true,
  defaultAcpCommand: `acp-${id}`,
  displayName: id.charAt(0).toUpperCase() + id.slice(1),
  id,
  installHint: "",
  installed: false,
  status: "missing",
  ...overrides,
});

// The panel invalidates the shared agent-detection query after install/save.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: PropsWithChildren) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);
const render = (ui: ReactElement) => renderBare(ui, { wrapper });

describe("AgentSetupPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    store.state = daemonState;
  });

  it("enables an agent and hides it from pickers from the same row", async () => {
    store.state = {
      snapshot: {
        agents: [
          {
            acpCommand: "acp-claude",
            displayName: "Claude",
            enabled: true,
            id: "claude",
            models: [],
          },
        ],
      },
    };
    queryClient.setQueryData(agentUpdatesQueryKey, [
      agent("claude", { installed: true, version: "1.0.0" }),
    ]);
    render(<AgentSetupPanel pickerVisibility />);

    const enabled = screen.getByRole("switch", { name: "Enable Claude" });
    expect(enabled).toBeChecked();
    await userEvent.click(enabled);
    expect(enabled).not.toBeChecked();

    const shown = screen.getByRole("button", { name: "Show Claude in agent pickers" });
    expect(shown).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(shown);
    expect(useUi.getState().pickers.hiddenAgents).toContain("claude");
    useUi.getState().setAgentHidden("claude", false);
  });

  it("seeds the list from the app-wide detection, skipping the detecting skeleton", () => {
    queryClient.setQueryData(agentUpdatesQueryKey, [
      agent("claude", { installed: true, version: "1.0.0" }),
    ]);
    render(<AgentSetupPanel />);

    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-list-skeleton")).not.toBeInTheDocument();
    // The cache is this same detection; no second shell-out on open.
    expect(detectAgents).not.toHaveBeenCalled();
  });

  it("auto-detects agents when no detected prop is provided", async () => {
    detectAgents.mockResolvedValue([agent("claude", { installed: true, version: "1.0.0" })]);
    render(<AgentSetupPanel />);
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
  });

  it("renders pre-loaded agents without calling detectAgents", async () => {
    render(<AgentSetupPanel detected={[agent("codex")]} />);
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(detectAgents).not.toHaveBeenCalled();
  });

  it("shows error when detectAgents rejects", async () => {
    detectAgents.mockRejectedValue(new Error("connection refused"));
    render(<AgentSetupPanel />);
    expect(await screen.findByText(/connection refused/)).toBeInTheDocument();
  });

  it("renders agent list with correct badges", async () => {
    const detected = [
      agent("claude", { installed: true, version: "1.0.0" }),
      agent("codex", { installed: false }),
      agent("copilot", {
        installed: true,
        status: "behind",
        version: "0.5.0",
        latestVersion: "0.6.0",
      }),
    ];
    render(<AgentSetupPanel detected={detected} />);
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("not found")).toBeInTheDocument();
    expect(screen.getByText("Copilot")).toBeInTheDocument();
    expect(screen.getByText("update available")).toBeInTheDocument();
    expect(screen.getByText("v0.5.0 → v0.6.0")).toBeInTheDocument();
  });

  describe("model refresh", () => {
    const configured = (models: unknown[]) => [
      {
        acpCommand: "acp-claude",
        displayName: "Claude",
        enabled: true,
        id: "claude",
        models,
      },
    ];
    const modelOption = (count: number) => ({
      category: "model",
      currentValue: "m0",
      id: "model",
      name: "Model",
      options: Array.from({ length: count }, (_, i) => ({ name: `M${i}`, value: `m${i}` })),
    });

    it("re-reads the model list on demand and shows how many are cached", async () => {
      daemonState.snapshot.agents = configured([modelOption(3)]);
      probeAgent.mockResolvedValue();
      render(<AgentSetupPanel detected={[agent("claude", { installed: true })]} />);

      expect(screen.getByText(/3 models/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Reload models list" }));
      expect(probeAgent).toHaveBeenCalledWith("claude");
    });

    it("reloads every enabled agent from the one button", async () => {
      daemonState.snapshot.agents = [
        ...configured([modelOption(3)]),
        { ...configured([modelOption(2)])[0], displayName: "Codex", id: "codex" },
      ];
      probeAgent.mockResolvedValue();
      render(
        <AgentSetupPanel
          detected={[agent("claude", { installed: true }), agent("codex", { installed: true })]}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Reload models list" }));
      expect(probeAgent).toHaveBeenCalledWith("claude");
      expect(probeAgent).toHaveBeenCalledWith("codex");
    });

    it("reports a failed probe instead of leaving the stale list unexplained", async () => {
      daemonState.snapshot.agents = configured([modelOption(1)]);
      probeAgent.mockRejectedValue(new Error("agent exited before replying"));
      render(<AgentSetupPanel detected={[agent("claude", { installed: true })]} />);

      await userEvent.click(screen.getByRole("button", { name: "Reload models list" }));
      expect(await screen.findByText(/agent exited before replying/)).toBeInTheDocument();
    });

    it("keeps one harness's failure off the others", async () => {
      daemonState.snapshot.agents = [
        ...configured([modelOption(3)]),
        { ...configured([modelOption(2)])[0], displayName: "Codex", id: "codex" },
      ];
      probeAgent.mockImplementation((id: string) =>
        id === "claude" ? Promise.reject(new Error("claude never answered")) : Promise.resolve(),
      );
      render(
        <AgentSetupPanel
          detected={[agent("claude", { installed: true }), agent("codex", { installed: true })]}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Reload models list" }));
      expect(await screen.findByText(/claude never answered/)).toBeInTheDocument();
      expect(probeAgent).toHaveBeenCalledWith("codex");
    });

    it("offers no reload when no agent is enabled yet", async () => {
      daemonState.snapshot.agents = [];
      render(<AgentSetupPanel detected={[agent("claude", { installed: true })]} />);

      expect(screen.queryByRole("button", { name: "Reload models list" })).not.toBeInTheDocument();
    });
  });

  describe("broken installs", () => {
    const installResult = (overrides: Partial<InstallAgentResult> = {}): InstallAgentResult => ({
      brokenInstall: false,
      command: "npm install -g @agentclientprotocol/codex-acp@latest --include=optional",
      ok: true,
      output: "",
      repaired: false,
      summary: null,
      verified: true,
      verifyError: null,
      ...overrides,
    });

    it("offers a Reinstall when an update installs but the agent will not start", async () => {
      const codex = agent("codex", {
        installed: true,
        status: "behind",
        version: "0.5.0",
        latestVersion: "0.6.0",
      });
      detectAgents.mockResolvedValue([codex]);
      installAgent.mockResolvedValue(
        installResult({
          brokenInstall: true,
          summary: "Missing optional dependency @openai/codex-darwin-arm64",
          verified: false,
          verifyError:
            "Codex process has exited with code 1: Missing optional dependency @openai/codex-darwin-arm64",
        }),
      );
      render(<AgentSetupPanel detected={[codex]} />);

      await userEvent.click(screen.getByRole("button", { name: "Update" }));

      expect(await screen.findByRole("button", { name: "Reinstall" })).toBeInTheDocument();
      expect(screen.getByText("needs reinstall")).toBeInTheDocument();
      // The healthy badge must not stand in for a broken agent.
      expect(screen.queryByText("update available")).not.toBeInTheDocument();
      expect(
        screen.getByText("Missing optional dependency @openai/codex-darwin-arm64"),
      ).toBeInTheDocument();
    });

    it("does not call an authentication failure a broken install", async () => {
      const codex = agent("codex", { installed: true, status: "behind", version: "0.5.0" });
      detectAgents.mockResolvedValue([codex]);
      installAgent.mockResolvedValue(
        installResult({
          verified: false,
          verifyError: "agent rejected session/new: Authentication required [-32000]",
        }),
      );
      render(<AgentSetupPanel detected={[codex]} />);

      await userEvent.click(screen.getByRole("button", { name: "Update" }));

      expect(await screen.findByText(/Authentication required/)).toBeInTheDocument();
      expect(screen.queryByText("signed out")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reinstall" })).not.toBeInTheDocument();
      expect(screen.queryByText("needs reinstall")).not.toBeInTheDocument();
    });

    it("shows just the summary when a broken agent has no reinstall path", async () => {
      const goose = agent("goose", {
        canReinstall: false,
        installed: true,
        status: "behind",
        version: "0.5.0",
      });
      detectAgents.mockResolvedValue([goose]);
      installAgent.mockResolvedValue(
        installResult({
          brokenInstall: true,
          summary: "native binary not found for darwin-arm64",
          verified: false,
          verifyError: "goose native binary not found for darwin-arm64",
        }),
      );
      render(<AgentSetupPanel detected={[goose]} />);

      await userEvent.click(screen.getByRole("button", { name: "Update" }));

      expect(await screen.findByText("cannot start")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reinstall" })).not.toBeInTheDocument();
    });

    it("reinstalls cleanly when the Reinstall button is used", async () => {
      const codex = agent("codex", { installed: true, status: "behind", version: "0.5.0" });
      detectAgents.mockResolvedValue([codex]);
      installAgent
        .mockResolvedValueOnce(
          installResult({
            brokenInstall: true,
            summary: "Cannot find module '@openai/codex'",
            verified: false,
            verifyError: "Cannot find module '@openai/codex'",
          }),
        )
        .mockResolvedValueOnce(installResult({ repaired: true }));
      render(<AgentSetupPanel detected={[codex]} />);

      await userEvent.click(screen.getByRole("button", { name: "Update" }));
      await userEvent.click(await screen.findByRole("button", { name: "Reinstall" }));

      expect(installAgent).toHaveBeenLastCalledWith("codex", true);
      expect(screen.queryByRole("button", { name: "Reinstall" })).not.toBeInTheDocument();
    });

    it("leaves a failed reinstall not installed with the normal Install action", async () => {
      const codex = agent("codex", { installed: true, status: "behind", version: "0.5.0" });
      const missing = agent("codex", { installed: false, status: "missing" });
      detectAgents.mockResolvedValue([missing]);
      installAgent.mockResolvedValue(
        installResult({
          brokenInstall: true,
          ok: false,
          output: "npm ERR! EACCES: permission denied",
          summary: "Missing optional dependency @openai/codex-darwin-arm64",
          verified: false,
          verifyError: "Missing optional dependency @openai/codex-darwin-arm64",
        }),
      );
      render(<AgentSetupPanel detected={[codex]} />);

      await userEvent.click(screen.getByRole("button", { name: "Update" }));

      expect(await screen.findByText(/EACCES: permission denied/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reinstall" })).not.toBeInTheDocument();
      expect(screen.getByText("not found")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
    });

    it("turns a broken-install probe failure into the Reinstall state", async () => {
      daemonState.snapshot.agents = [
        {
          acpCommand: "acp-claude",
          displayName: "Claude",
          enabled: true,
          id: "claude",
          models: [],
        },
      ];
      probeAgent.mockRejectedValue(
        new DaemonRpcError(
          "agent_broken_install",
          "Missing optional dependency @anthropic-ai/claude-agent-sdk-darwin-arm64",
        ),
      );
      render(
        <AgentSetupPanel detected={[agent("claude", { installed: true, version: "1.0.0" })]} />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Reload models list" }));

      expect(await screen.findByRole("button", { name: "Reinstall" })).toBeInTheDocument();
      expect(screen.getByText("needs reinstall")).toBeInTheDocument();
      expect(
        screen.getByText("Missing optional dependency @anthropic-ai/claude-agent-sdk-darwin-arm64"),
      ).toBeInTheDocument();
      expect(screen.queryByText("v1.0.0")).not.toBeInTheDocument();
    });

    it("shows broken from the daemon's tracked health, before any manual action", async () => {
      const codex = agent("codex", {
        installed: true,
        brokenInstall: {
          detail:
            "Codex process has exited with code 1: Missing optional dependency @openai/codex-darwin-arm64",
          summary: "Missing optional dependency @openai/codex-darwin-arm64",
        },
      });
      render(<AgentSetupPanel detected={[codex]} />);

      expect(screen.getByText("needs reinstall")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reinstall" })).toBeInTheDocument();
      expect(
        screen.getByText("Missing optional dependency @openai/codex-darwin-arm64"),
      ).toBeInTheDocument();
      // No action was taken — install/probe must not have been called.
      expect(installAgent).not.toHaveBeenCalled();
      expect(probeAgent).not.toHaveBeenCalled();
    });

    it("follows live health updates after the list was seeded", () => {
      const summary = "Missing optional dependency @openai/codex-darwin-arm64";
      render(
        <AgentSetupPanel detected={[agent("codex", { installed: true, version: "1.0.0" })]} />,
      );
      expect(screen.getByText("v1.0.0")).toBeInTheDocument();

      const push = (broken: { detail: string; summary: string } | null) =>
        act(() => {
          store.state = { ...store.state, agentHealth: { codex: broken } };
          store.listeners.forEach((fn) => fn());
          const event: DaemonEvent = {
            data: { broken, id: "codex" },
            event: "agents.healthUpdated",
          };
          store.eventListeners.forEach((fn) => fn(event));
        });

      push({ detail: summary, summary });
      expect(screen.getByText("needs reinstall")).toBeInTheDocument();
      expect(screen.getByText(summary)).toBeInTheDocument();

      push(null);
      expect(screen.queryByText("needs reinstall")).not.toBeInTheDocument();
      expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    });

    it("offers no reinstall for a health mark on an agent that cannot be reinstalled", async () => {
      const goose = agent("goose", {
        brokenInstall: {
          detail: "goose native binary not found for darwin-arm64",
          summary: "native binary not found for darwin-arm64",
        },
        canReinstall: false,
        installed: true,
      });
      render(<AgentSetupPanel detected={[goose]} />);

      expect(screen.getByText("cannot start")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reinstall" })).not.toBeInTheDocument();
    });
  });
});
