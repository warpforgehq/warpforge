import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUi } from "@/store/ui";

import { AgentUpdateBanner } from "./AgentUpdateBanner";

const { count } = vi.hoisted(() => ({ count: vi.fn<() => number>() }));

vi.mock("@/hooks/useAgentUpdates", () => ({
  agentUpdatesQueryKey: ["agents", "detect"],
  useAgentUpdates: () => ({ data: undefined }),
  useAgentUpdatesCount: () => count(),
}));

beforeEach(() => {
  count.mockReset();
  useUi.getState().setSettingsPage("appearance");
});

describe("AgentUpdateBanner", () => {
  it("stays out of the way when every agent is current", () => {
    count.mockReturnValue(0);
    const { container } = render(<AgentUpdateBanner onOpenSettings={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names how many agents are behind", () => {
    count.mockReturnValue(2);
    render(<AgentUpdateBanner onOpenSettings={() => {}} />);
    expect(screen.getByText("2 agent updates available")).toBeInTheDocument();
  });

  it("opens Settings on the Agents page", () => {
    count.mockReturnValue(1);
    const onOpenSettings = vi.fn<() => void>();
    render(<AgentUpdateBanner onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByText("1 agent update available"));
    expect(onOpenSettings).toHaveBeenCalled();
    expect(useUi.getState().settingsPage).toBe("agents");
  });
});
