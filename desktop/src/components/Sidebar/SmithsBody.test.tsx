import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PeerMessage, TaskInfo } from "@/protocol";
import { usePeersStore } from "@/store/peers";
import { useUi } from "@/store/ui";
import { setSmiths, smithFixture } from "@/test/smiths";

const unread = vi.hoisted(() => ({ value: 0 }));
vi.mock("@/hooks/useSmiths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useSmiths")>()),
  useSmithUnread: () => unread.value,
}));
const { createChannel } = vi.hoisted(() => ({
  createChannel: vi.fn<(project: string, name: string) => Promise<unknown>>(),
}));
vi.mock("@/daemon", () => ({ daemon: { createChannel } }));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select aria-label="Project" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

import { SmithsBody } from "./SmithsBody";

const dm = (project: string, id: number): PeerMessage => ({
  createdAt: 1,
  fromTask: "t_a",
  id,
  project,
  status: "delivered",
  text: "hi",
  toTask: "t_b",
});

function task(id: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    agent: "claude",
    createdAt: 1,
    id,
    project: "warpforge",
    prompt: id,
    status: "waiting",
    tags: [],
    title: id,
    updatedAt: 1,
    ...overrides,
  } as TaskInfo;
}

function show(tasks: TaskInfo[] = []) {
  return render(<SmithsBody projects={["warpforge", "api"]} tasks={tasks} />);
}

function section(name: string) {
  return screen.getByRole("region", { name });
}

describe("SmithsBody", () => {
  beforeEach(() => {
    unread.value = 0;
    setSmiths([]);
    usePeersStore.setState({ channels: {}, records: {} });
    useUi.setState({
      newSmithOpen: false,
      openTaskId: null,
      selectedProjectId: null,
      smithsProject: null,
      teamSelection: null,
      view: "control",
    });
  });

  it("explains Smiths and opens New smith when there are none", async () => {
    show();
    expect(screen.getByText(/Smiths are your AI teammates/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create your first smith" }));
    expect(useUi.getState().newSmithOpen).toBe(true);
  });

  it("shows one project at a time, defaulting to the one open in Tasks", async () => {
    setSmiths([
      smithFixture(),
      smithFixture({ allowedProjects: ["api"], homeProject: "api", id: "sm_2", name: "Grace" }),
    ]);
    usePeersStore.setState({ records: { 1: dm("warpforge", 1), 2: dm("api", 2) } });
    useUi.setState({ selectedProjectId: "api" });
    show();
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveValue("api");
    expect(within(section("Smiths")).getByText("Grace")).toBeInTheDocument();
    expect(within(section("Smiths")).queryByText("Ada")).toBeNull();
    expect(within(section("Direct")).getAllByText(/↔/)).toHaveLength(1);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Project" }), "warpforge");
    expect(useUi.getState().smithsProject).toBe("warpforge");
    expect(within(section("Smiths")).getByText("Ada")).toBeInTheDocument();
  });

  it("puts one + in each section header, and none under the projects", async () => {
    setSmiths([smithFixture()]);
    show();
    expect(screen.getAllByRole("button", { name: "New channel" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "New smith" }));
    expect(useUi.getState().newSmithOpen).toBe(true);
    expect(screen.getByRole("button", { name: "New direct message" })).toBeInTheDocument();
  });

  it("shows a Smith's status, its note, or its unread count", () => {
    setSmiths([smithFixture()]);
    const { unmount } = show([
      task("t_fix", { smithId: "sm_1", status: "running", title: "fixing CI" }),
    ]);
    expect(screen.getByRole("img", { name: "Ada, working" })).toBeInTheDocument();
    expect(screen.getByText("fixing CI")).toBeInTheDocument();
    unmount();

    const noted = show([
      task("t_thread", { smithId: "sm_1", statusNote: "watching the PR queue" }),
      task("t_fix", { smithId: "sm_1", status: "running", title: "fixing CI" }),
    ]);
    expect(screen.getByText("watching the PR queue")).toBeInTheDocument();
    noted.unmount();

    unread.value = 2;
    show();
    expect(screen.getByLabelText("2 unread")).toBeInTheDocument();
  });

  it("lists the project's channels after #general and creates one", async () => {
    usePeersStore.setState({
      channels: {
        c1: { createdAt: 1, id: "c1", members: [], name: "release", project: "warpforge" },
        c2: { createdAt: 1, id: "c2", members: [], name: "ci", project: "warpforge" },
        c3: { createdAt: 1, id: "c3", members: [], name: "ops", project: "api" },
      },
    });
    createChannel.mockResolvedValue({
      createdAt: 2,
      id: "c4",
      members: [],
      name: "docs",
      project: "warpforge",
    });
    show();
    const channels = within(section("Channels"))
      .getAllByRole("button")
      .slice(1)
      .map((b) => b.textContent);
    expect(channels).toStrictEqual(["general", "ci", "release"]);

    await userEvent.click(screen.getByRole("button", { name: "New channel" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Channel name" }), "docs");
    await userEvent.click(screen.getByRole("button", { name: "Create channel" }));
    expect(createChannel).toHaveBeenCalledWith("warpforge", "docs");
    expect(useUi.getState().teamSelection).toStrictEqual({
      key: "warpforge::ch::c4",
      kind: "conversation",
    });
  });

  it("highlights the selection only while the Smiths area is showing", () => {
    setSmiths([smithFixture()]);
    useUi.setState({ teamSelection: { id: "sm_1", kind: "teammate" }, view: "control" });
    const { rerender } = show();
    expect(screen.getByRole("button", { name: /Ada/ })).not.toHaveAttribute("aria-current");
    useUi.setState({ view: "team" });
    rerender(<SmithsBody projects={["warpforge", "api"]} tasks={[]} />);
    expect(screen.getByRole("button", { name: /Ada/ })).toHaveAttribute("aria-current", "true");
  });
});
