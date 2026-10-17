import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Conversation } from "@/lib/peerFeed";
import { smithFixture } from "@/test/smiths";

const unread = vi.hoisted(() => ({ value: 0 }));
vi.mock("@/hooks/useSmiths", () => ({ useSmithUnread: () => unread.value }));

import type { TeamSelection } from "./selection";
import { TeamSidebar } from "./TeamSidebar";

const dm: Conversation = {
  key: "demo::dm::t_a|t_b",
  kind: "dm",
  lastAt: 3,
  parties: ["t_a", "t_b"],
  project: "demo",
  records: [],
};

function show(selection: TeamSelection | null = null) {
  const onSelect = vi.fn<(selection: TeamSelection) => void>();
  render(
    <TeamSidebar
      projects={["demo", "api"]}
      dms={[dm]}
      smiths={[
        smithFixture(),
        smithFixture({ held: ["paused"], id: "sm_2", name: "Grace", threadTaskId: "t_g" }),
      ]}
      tasks={[]}
      pausedProjects={["api"]}
      selection={selection}
      label={(id) => id ?? "You"}
      onSelect={onSelect}
    />,
  );
  return onSelect;
}

describe("TeamSidebar", () => {
  it("lists #general under each project and opens its feed", async () => {
    const onSelect = show();
    const channels = screen.getByRole("region", { name: "Channels" });
    expect(channels.textContent).toContain("demo");
    expect(channels.textContent).toContain("api");
    expect(screen.queryByRole("button", { name: /New channel/ })).toBeNull();
    await userEvent.click(screen.getAllByRole("button", { name: /general/ })[0]!);
    expect(onSelect).toHaveBeenCalledWith({ key: "demo::team", kind: "conversation" });
  });

  it("keeps the direct threads between sessions", async () => {
    const onSelect = show();
    await userEvent.click(screen.getByRole("button", { name: /t_a ↔ t_b/ }));
    expect(onSelect).toHaveBeenCalledWith({ key: dm.key, kind: "conversation" });
  });

  it("shows each teammate's status and unread count, and offers a new one", async () => {
    unread.value = 3;
    const onSelect = show({ id: "sm_1", kind: "teammate" });
    expect(screen.getByRole("img", { name: "idle" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "held: paused" })).toBeTruthy();
    expect(screen.getAllByLabelText("3 unread")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Ada/ }).getAttribute("aria-current")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: /Grace/ }));
    expect(onSelect).toHaveBeenCalledWith({ id: "sm_2", kind: "teammate" });
    await userEvent.click(screen.getByRole("button", { name: "New teammate" }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "newTeammate" });
    unread.value = 0;
  });
});
