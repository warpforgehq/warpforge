import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Channel } from "@/protocol";
import { usePeersStore } from "@/store/peers";
import { setSmiths, smithFixture } from "@/test/smiths";

const daemonMock = vi.hoisted(() => ({
  addChannelMember: vi.fn<(id: string, smithId: string) => Promise<unknown>>(),
  deleteChannel: vi.fn<(id: string) => Promise<void>>(async () => {}),
  removeChannelMember: vi.fn<(id: string, smithId: string) => Promise<unknown>>(),
  renameChannel: vi.fn<(id: string, name: string) => Promise<unknown>>(),
  setPeerPaused: vi.fn<(project: string, paused: boolean) => Promise<unknown>>(),
}));
vi.mock("@/daemon", () => ({ daemon: daemonMock }));
vi.mock("sonner", () => ({ toast: { error: vi.fn<() => void>() } }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ChannelHeaderActions } from "./ChannelHeaderActions";

const ci: Channel = {
  createdAt: 1,
  id: "c1",
  members: [{ name: "Ada", smithId: "sm_1" }],
  name: "ci",
  project: "warpforge",
};

describe("ChannelHeaderActions", () => {
  beforeEach(() => {
    setSmiths([
      smithFixture(),
      smithFixture({ id: "sm_2", name: "Grace", threadTaskId: "t_g" }),
      smithFixture({ allowedProjects: ["other"], id: "sm_3", name: "Linus", threadTaskId: "t_l" }),
    ]);
    usePeersStore.setState({
      channels: { c1: ci },
      controls: { mutedTasks: [], pausedProjects: [] },
    });
  });

  it("shows members as avatars and adds only Smiths allowed in the project", async () => {
    daemonMock.addChannelMember.mockResolvedValue(ci);
    daemonMock.removeChannelMember.mockResolvedValue(ci);
    render(<ChannelHeaderActions project="warpforge" channel={ci} />);
    expect(screen.getByRole("group", { name: "Members" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Linus/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Grace/ }));
    expect(daemonMock.addChannelMember).toHaveBeenCalledWith("c1", "sm_2");
    await userEvent.click(screen.getByRole("button", { name: "Remove from #ci" }));
    expect(daemonMock.removeChannelMember).toHaveBeenCalledWith("c1", "sm_1");
  });

  it("renames and deletes from the ⋯ menu", async () => {
    daemonMock.renameChannel.mockResolvedValue({ ...ci, name: "builds" });
    render(<ChannelHeaderActions project="warpforge" channel={ci} />);
    await userEvent.click(screen.getByRole("button", { name: /Rename/ }));
    const input = screen.getByRole("textbox", { name: "Channel name" });
    await userEvent.clear(input);
    await userEvent.type(input, "builds");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(daemonMock.renameChannel).toHaveBeenCalledWith("c1", "builds");
    await userEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete channel" }));
    expect(daemonMock.deleteChannel).toHaveBeenCalledWith("c1");
  });

  it("offers Pause project on #general, which has no members", async () => {
    daemonMock.setPeerPaused.mockResolvedValue({ mutedTasks: [], pausedProjects: ["warpforge"] });
    render(<ChannelHeaderActions project="warpforge" />);
    expect(screen.queryByRole("group", { name: "Members" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Pause project/ }));
    expect(daemonMock.setPeerPaused).toHaveBeenCalledWith("warpforge", true);
  });
});
