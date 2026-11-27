import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { daemon, type DaemonState } from "@/daemon";
import { type ContextMenuEntry, ContextMenuProvider } from "@/hooks/useContextMenu";
import { EMPTY_SNAPSHOT, type Space } from "@/protocol";
import { usePins } from "@/store/pins";
import { useRemoveProject } from "@/views/projects/RemoveProjectHost";

import { useAddToSpace } from "./addToSpace";
import { projectMenu, useProjectContextMenu } from "./projectMenu";

const payments: Space = { id: "s1", members: [{ kind: "project", name: "api" }], name: "Payments" };
const ops: Space = { id: "s2", members: [], name: "Ops" };

beforeEach(() => {
  vi.spyOn(daemon, "getState").mockReturnValue({
    snapshot: {
      ...EMPTY_SNAPSHOT,
      projects: [
        {
          agentTemplates: {},
          declaredServices: [],
          name: "api",
          path: "/work/api",
          portRange: [4000, 4099],
        },
      ],
      spaces: [payments, ops],
    },
  } as unknown as DaemonState);
});

afterEach(() => {
  vi.restoreAllMocks();
  usePins.setState({ pins: [] });
  useAddToSpace.getState().close();
  useRemoveProject.getState().close();
});

function submenu(items: ContextMenuEntry[]) {
  const move = items.find((item) => item.type === "submenu");
  return move?.type === "submenu" ? move : null;
}

it("checks the project's space and moves it by leaving that space first", async () => {
  const calls: string[] = [];
  vi.spyOn(daemon, "removeSpaceMember").mockImplementation(async (id) => {
    calls.push(`remove:${id}`);
    return payments;
  });
  vi.spyOn(daemon, "addSpaceMember").mockImplementation(async (id) => {
    calls.push(`add:${id}`);
    return ops;
  });
  const { items, handlers } = projectMenu("api", () => {});

  const move = submenu(items)!;
  expect(move.label).toBe("Move to space");
  expect(move.items).toContainEqual({
    type: "checkbox",
    id: "space:s1",
    label: "Payments",
    checked: true,
  });
  expect(move.items).toContainEqual({
    type: "checkbox",
    id: "space:s2",
    label: "Ops",
    checked: false,
  });

  handlers.get("space:s2")!();
  await vi.waitFor(() => expect(calls).toEqual(["remove:s1", "add:s2"]));
});

it("leaves the space, or opens New space on the dialog", () => {
  const remove = vi.spyOn(daemon, "removeSpaceMember").mockResolvedValue(payments);
  const { handlers } = projectMenu("api", () => {});

  handlers.get("leave-space")!();
  expect(remove).toHaveBeenCalledWith("s1", { kind: "project", name: "api" });

  handlers.get("new-space")!();
  expect(useAddToSpace.getState()).toMatchObject({ newSpace: true, project: "api" });
});

it("starts a task, pins, and asks before removing", () => {
  const onNewTask = vi.fn<(project: string) => void>();
  const { handlers } = projectMenu("api", onNewTask);

  handlers.get("new-task")!();
  expect(onNewTask).toHaveBeenCalledWith("api");
  handlers.get("pin")!();
  expect(usePins.getState().pins).toEqual([{ id: "api", kind: "project" }]);
  handlers.get("remove")!();
  expect(useRemoveProject.getState().project).toBe("api");
});

function Row() {
  const menu = useProjectContextMenu(() => {});
  return (
    <button type="button" onContextMenu={(event) => menu(event, "api")}>
      api
    </button>
  );
}

it("renders the project menu on right-click", () => {
  render(
    <ContextMenuProvider>
      <Row />
    </ContextMenuProvider>,
  );
  fireEvent.contextMenu(screen.getByRole("button", { name: "api" }));

  for (const label of [
    "New task in api",
    "Open in Finder",
    "Copy path",
    "Open space Payments",
    "Move to space",
    "Pin to rail",
    "Remove project…",
  ]) {
    expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
  }
});
