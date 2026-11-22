import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentUpdateDismissal } from "@/store/agentUpdates";
import { useUi } from "@/store/ui";

import { AgentUpdateBanner } from "./AgentUpdateBanner";

const { keys } = vi.hoisted(() => ({ keys: vi.fn<() => string[]>() }));

vi.mock("@/hooks/useAgentUpdates", () => ({
  agentUpdatesQueryKey: ["agents", "detect"],
  useAgentUpdates: () => ({ data: undefined }),
  useAgentUpdateKeys: () => keys(),
}));

beforeEach(() => {
  keys.mockReset();
  useAgentUpdateDismissal.setState({ dismissed: [] });
  useUi.getState().setSettingsPage("appearance");
});

describe("AgentUpdateBanner", () => {
  it("stays out of the way when every agent is current", () => {
    keys.mockReturnValue([]);
    const { container } = render(<AgentUpdateBanner onOpenSettings={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names how many agents are behind", () => {
    keys.mockReturnValue(["claude@2", "codex@3"]);
    render(<AgentUpdateBanner onOpenSettings={() => {}} />);
    expect(screen.getByText("2 agent updates available")).toBeInTheDocument();
  });

  it("opens Settings on the Agents page", () => {
    keys.mockReturnValue(["claude@2"]);
    const onOpenSettings = vi.fn<() => void>();
    render(<AgentUpdateBanner onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByText("1 agent update available"));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(useUi.getState().settingsPage).toBe("agents");
  });

  it("dismisses the updates it shows", () => {
    useAgentUpdateDismissal.setState({ dismissed: ["goose@1"] });
    keys.mockReturnValue(["claude@2"]);
    render(<AgentUpdateBanner onOpenSettings={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss agent updates" }));
    expect(useAgentUpdateDismissal.getState().dismissed).toEqual(["goose@1", "claude@2"]);
  });
});
