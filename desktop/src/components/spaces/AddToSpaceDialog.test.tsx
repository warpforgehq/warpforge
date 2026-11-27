import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { daemon, type DaemonState } from "@/daemon";
import { EMPTY_SNAPSHOT, type Space } from "@/protocol";

import { useAddToSpace } from "./addToSpace";
import { AddToSpaceDialog } from "./AddToSpaceDialog";

const payments: Space = { id: "s1", members: [], name: "Payments" };

beforeEach(() => {
  vi.spyOn(daemon, "subscribe").mockReturnValue(() => {});
  vi.spyOn(daemon, "getState").mockReturnValue({
    snapshot: { ...EMPTY_SNAPSHOT, spaces: [payments] },
  } as unknown as DaemonState);
  vi.spyOn(daemon, "addSpaceMember").mockResolvedValue(payments);
  vi.spyOn(daemon, "createSpace").mockResolvedValue({ id: "s2", members: [], name: "Infra" });
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => useAddToSpace.getState().close());
});

it("adds the project to an existing space", async () => {
  render(<AddToSpaceDialog />);
  act(() => useAddToSpace.getState().open("api"));

  await userEvent.click(screen.getByRole("button", { name: "Add to space" }));
  expect(daemon.addSpaceMember).toHaveBeenCalledWith("s1", { kind: "project", name: "api" });
  expect(useAddToSpace.getState().project).toBeNull();
});

it("creates a new space for the project", async () => {
  render(<AddToSpaceDialog />);
  act(() => useAddToSpace.getState().open("api"));

  await userEvent.click(screen.getByRole("radio", { name: "New space…" }));
  await userEvent.type(screen.getByRole("textbox", { name: "New space name" }), "Infra");
  await userEvent.click(screen.getByRole("button", { name: "Add to space" }));
  expect(daemon.createSpace).toHaveBeenCalledWith("Infra");
  expect(daemon.addSpaceMember).toHaveBeenCalledWith("s2", { kind: "project", name: "api" });
});

it("shows the one-space-per-project refusal inline", async () => {
  vi.mocked(daemon.addSpaceMember).mockRejectedValue(
    new Error('Project "api" already belongs to space "Core"'),
  );
  render(<AddToSpaceDialog />);
  act(() => useAddToSpace.getState().open("api"));

  await userEvent.click(screen.getByRole("button", { name: "Add to space" }));
  expect(await screen.findByRole("alert")).toHaveTextContent('already belongs to space "Core"');
  expect(useAddToSpace.getState().project).toBe("api");
});

it("opens on New space and moves the project out of its current space", async () => {
  vi.mocked(daemon.getState).mockReturnValue({
    snapshot: {
      ...EMPTY_SNAPSHOT,
      spaces: [{ ...payments, members: [{ kind: "project", name: "api" }] }],
    },
  } as unknown as DaemonState);
  const remove = vi.spyOn(daemon, "removeSpaceMember").mockResolvedValue(payments);
  render(<AddToSpaceDialog />);
  act(() => useAddToSpace.getState().open("api", true));

  await userEvent.type(screen.getByRole("textbox", { name: "New space name" }), "Infra");
  await userEvent.click(screen.getByRole("button", { name: "Add to space" }));

  expect(remove).toHaveBeenCalledWith("s1", { kind: "project", name: "api" });
  expect(daemon.addSpaceMember).toHaveBeenCalledWith("s2", { kind: "project", name: "api" });
});
