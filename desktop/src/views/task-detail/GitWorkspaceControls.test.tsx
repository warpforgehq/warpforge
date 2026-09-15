import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({
  request: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(),
}));

vi.mock("../../daemon", () => ({ daemon: { request } }));

import { GitWorkspaceControls } from "./GitWorkspaceControls";

function renderControls() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GitWorkspaceControls
        taskId="task-1"
        branch="main"
        onOpenCommit={vi.fn<() => void>()}
        onOpenPush={vi.fn<() => void>()}
      />
    </QueryClientProvider>,
  );
}

describe("GitWorkspaceControls branch popover", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("paints nothing while the branches resolve — a one-frame skeleton is a glitch", () => {
    request.mockImplementation(() => new Promise(() => {}));

    const { container } = renderControls();
    fireEvent.click(screen.getByTitle("Branches and Git actions"));

    // The list is local and resolves in about a frame, so the popover stays
    // silent: no sentence, and no skeleton stood in for the list.
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(container.querySelector("[aria-busy]")).toBeNull();
  });
});
