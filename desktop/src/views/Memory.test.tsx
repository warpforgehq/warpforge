import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import type { Memory as MemoryItem, MemoryProposal, Snapshot } from "@/protocol";
import { EMPTY_SNAPSHOT } from "@/protocol";

import Memory from "./Memory";
import MemoryPage from "./settings/pages/Memory";

function memory(patch: Partial<MemoryItem> = {}): MemoryItem {
  return {
    content: "The API listens on port 8080",
    createdAt: 1000,
    id: "m-1",
    kind: "fact",
    lastAccessed: 1000,
    scope: "global",
    tags: ["infra"],
    updatedAt: 1000,
    ...patch,
  };
}

const proposal: MemoryProposal = {
  created_at: 1000,
  id: 7,
  proposal_type: "duplicate",
  reason: "Same fact stored twice",
  status: "pending",
  target_ids: "m-1,m-2",
};

const snapshot: Snapshot = { ...EMPTY_SNAPSHOT };

function renderMemory(inSettings = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Memory
        snapshot={snapshot}
        onOpenTask={vi.fn<(id: string) => void>()}
        header={inSettings ? (tabs) => <MemoryPage actions={tabs} /> : undefined}
      />
    </QueryClientProvider>,
  );
}

const stored = [memory(), memory({ content: "Deploys go through CI", id: "m-2", tags: [] })];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(daemon, "memoryStats").mockResolvedValue({
    embeddingMode: "fts",
    globalCount: 2,
    perProjectDbExists: false,
    projectCount: 0,
    scopesEnabled: { global: true, project: true },
  });
  vi.spyOn(daemon, "listMemories").mockResolvedValue(stored);
  vi.spyOn(daemon, "searchMemories").mockResolvedValue([]);
  vi.spyOn(daemon, "memoryEdges").mockResolvedValue([]);
  vi.spyOn(daemon, "listMemoryProposals").mockResolvedValue([proposal]);
});

describe("Memory screen", () => {
  it("lists memories and shows the pending proposal count", async () => {
    renderMemory();

    expect(await screen.findByText("The API listens on port 8080")).toBeInTheDocument();
    expect(screen.getByText("Deploys go through CI")).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: /Proposals\s*1/ })).toBeInTheDocument();
  });

  it("puts the Memories/Proposals tabs in the settings page header", async () => {
    renderMemory(true);

    const header = screen.getByRole("heading", { name: "Memory", level: 1 }).closest("header");
    expect(header).not.toBeNull();
    expect(within(header!).getByRole("tab", { name: "Memories" })).toBeInTheDocument();
    expect(await within(header!).findByRole("tab", { name: /Proposals\s*1/ })).toBeInTheDocument();
    expect(screen.getByText("Select a memory to read, edit or link it.")).toBeInTheDocument();
  });

  it("searches with the raw text, including a hash", async () => {
    renderMemory();
    await screen.findByText("Deploys go through CI");

    await userEvent.type(screen.getByLabelText("Search memories"), "issue #82");

    await waitFor(() =>
      expect(daemon.searchMemories).toHaveBeenCalledWith(
        expect.objectContaining({ query: "issue #82" }),
      ),
    );
  });

  it("says so when a search finds nothing", async () => {
    renderMemory();
    await userEvent.type(await screen.findByLabelText("Search memories"), "zzz");

    expect(await screen.findByText("Nothing matches")).toBeInTheDocument();
  });

  it("shows the empty state and the error state", async () => {
    vi.spyOn(daemon, "listMemories").mockResolvedValue([]);
    const view = renderMemory();
    expect(await screen.findByText("No memories yet")).toBeInTheDocument();
    view.unmount();

    vi.spyOn(daemon, "listMemories").mockRejectedValue(new Error("global memory is disabled"));
    renderMemory();
    expect(await screen.findByRole("alert")).toHaveTextContent("global memory is disabled");
  });

  it("edits a memory and saves the new text", async () => {
    const update = vi.spyOn(daemon, "updateMemory").mockResolvedValue(memory());
    renderMemory();
    await userEvent.click(await screen.findByText("The API listens on port 8080"));

    const box = await screen.findByLabelText("Memory content");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.clear(box);
    await userEvent.type(box, "Port 9090");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith("m-1", "Port 9090"));
  });

  it("deletes only after the confirmation", async () => {
    const remove = vi.spyOn(daemon, "deleteMemory").mockResolvedValue();
    renderMemory();
    await userEvent.click(await screen.findByText("The API listens on port 8080"));

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(remove).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("m-1"));
  });

  it("adds a link from the open memory to another one", async () => {
    const add = vi.spyOn(daemon, "addMemoryEdge").mockResolvedValue({
      createdAt: 1,
      dstId: "m-2",
      relation: "supports",
      srcId: "m-1",
    });
    renderMemory();
    await userEvent.click(await screen.findByText("The API listens on port 8080"));

    await userEvent.selectOptions(await screen.findByLabelText("Relation"), "supports");
    await userEvent.type(screen.getByLabelText("Find a memory to link"), "deploys");
    await userEvent.click(await screen.findByRole("button", { name: "Deploys go through CI" }));
    await userEvent.click(screen.getByRole("button", { name: "Add link" }));

    await waitFor(() => expect(add).toHaveBeenCalledWith("m-1", "m-2", "supports"));
  });

  it("asks before approving a proposal that deletes, then applies it", async () => {
    const resolve = vi
      .spyOn(daemon, "resolveMemoryProposal")
      .mockResolvedValue({ status: "applied" });
    renderMemory();
    await userEvent.click(await screen.findByRole("tab", { name: /Proposals/ }));

    expect(await screen.findByText("Same fact stored twice")).toBeInTheDocument();
    expect(screen.getByText(/keeps the oldest memory and deletes the other 1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(resolve).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(7, true, true));
  });

  it("offers to apply a proposal an agent approved without deleting", async () => {
    vi.spyOn(daemon, "listMemoryProposals").mockResolvedValue([{ ...proposal, status: "applied" }]);
    const resolve = vi
      .spyOn(daemon, "resolveMemoryProposal")
      .mockResolvedValue({ status: "applied" });
    renderMemory();
    await userEvent.click(await screen.findByRole("tab", { name: /Proposals/ }));

    expect(await screen.findByText("Approved by an agent, not applied")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(7, true, true));
  });

  it("hides an approved proposal whose targets are already gone", async () => {
    vi.spyOn(daemon, "listMemories").mockResolvedValue([stored[0]!]);
    vi.spyOn(daemon, "listMemoryProposals").mockResolvedValue([{ ...proposal, status: "applied" }]);
    renderMemory();
    await userEvent.click(await screen.findByRole("tab", { name: /Proposals/ }));

    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
  });

  it("rejects without a confirmation", async () => {
    const resolve = vi
      .spyOn(daemon, "resolveMemoryProposal")
      .mockResolvedValue({ status: "rejected" });
    renderMemory();
    await userEvent.click(await screen.findByRole("tab", { name: /Proposals/ }));

    await userEvent.click(await screen.findByRole("button", { name: "Reject" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(7, false, true));
  });

  it("labels a proposal that changes nothing as Mark done", async () => {
    vi.spyOn(daemon, "listMemoryProposals").mockResolvedValue([
      { ...proposal, proposal_type: "merge" },
    ]);
    const resolve = vi
      .spyOn(daemon, "resolveMemoryProposal")
      .mockResolvedValue({ status: "applied" });
    renderMemory();
    await userEvent.click(await screen.findByRole("tab", { name: /Proposals/ }));

    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Mark done" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(7, true, true));
  });
});
