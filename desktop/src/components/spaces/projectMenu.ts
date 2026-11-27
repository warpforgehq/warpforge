import type { MouseEvent } from "react";
import { toast } from "sonner";

import { daemon } from "@/daemon";
import { type ContextMenuEntry, useContextMenu } from "@/hooks/useContextMenu";
import { copyText } from "@/lib/clipboard";
import { IS_TAURI } from "@/lib/platform";
import { pinKey, usePins } from "@/store/pins";
import { spaceOfProject, useUi } from "@/store/ui";
import { useRemoveProject } from "@/views/projects/RemoveProjectHost";

import { moveProjectToSpace, useAddToSpace } from "./addToSpace";

const report = (action: Promise<unknown>) =>
  void action.catch((cause: unknown) =>
    toast.error(cause instanceof Error ? cause.message : String(cause)),
  );

/**
 * The menu entries for one project, with their handlers.
 * @param project the project name
 * @param onNewTask starts a task in a project
 * @returns entries and the handler for each entry id
 */
export function projectMenu(
  project: string,
  onNewTask: (project: string) => void,
): { items: ContextMenuEntry[]; handlers: Map<string, () => void> } {
  const { snapshot } = daemon.getState();
  const spaces = snapshot.spaces ?? [];
  const path = snapshot.projects.find((candidate) => candidate.name === project)?.path;
  const space = spaceOfProject(project, spaces);
  const pin = { id: project, kind: "project" } as const;
  const pinned = usePins.getState().pins.some((candidate) => pinKey(candidate) === pinKey(pin));

  const items: ContextMenuEntry[] = [
    { type: "item", id: "new-task", label: `New task in ${project}` },
    { type: "item", id: "edit", label: "Edit project" },
    { type: "item", id: "reveal", label: "Open in Finder", disabled: !IS_TAURI || !path },
    { type: "item", id: "copy-path", label: "Copy path", disabled: !path },
    { type: "separator" },
    ...(space
      ? [{ type: "item", id: "open-space", label: `Open space ${space.name}` } as const]
      : []),
    {
      type: "submenu",
      id: "move",
      label: space ? "Move to space" : "Add to space",
      items: [
        ...spaces.map(
          (candidate): ContextMenuEntry => ({
            type: "checkbox",
            id: `space:${candidate.id}`,
            label: candidate.name,
            checked: candidate.id === space?.id,
          }),
        ),
        ...(spaces.length > 0 ? [{ type: "separator" } as const] : []),
        ...(space
          ? [{ type: "item", id: "leave-space", label: "Remove from space" } as const]
          : []),
        { type: "item", id: "new-space", label: "New space…" },
      ],
    },
    { type: "separator" },
    { type: "item", id: "pin", label: pinned ? "Unpin from rail" : "Pin to rail" },
    { type: "separator" },
    { type: "item", id: "remove", label: "Remove project…", destructive: true },
  ];

  const handlers = new Map<string, () => void>([
    ["new-task", () => onNewTask(project)],
    ["edit", () => useUi.getState().openProject(project, "config")],
    [
      "reveal",
      () =>
        path &&
        report(
          import("@tauri-apps/plugin-opener").then(({ revealItemInDir }) => revealItemInDir(path)),
        ),
    ],
    ["copy-path", () => path && void copyText(path, "Path")],
    ["open-space", () => space && useUi.getState().openSpace(space.id)],
    [
      "leave-space",
      () => space && report(daemon.removeSpaceMember(space.id, { kind: "project", name: project })),
    ],
    ["new-space", () => useAddToSpace.getState().open(project, true)],
    ["pin", () => usePins.getState().toggle(pin)],
    ["remove", () => useRemoveProject.getState().open(project)],
  ]);
  for (const candidate of spaces) {
    handlers.set(`space:${candidate.id}`, () => {
      if (candidate.id !== space?.id) report(moveProjectToSpace(project, candidate.id, spaces));
    });
  }
  return { items, handlers };
}

/**
 * A project's right-click menu, for sidebar rows and rail pins.
 * @param onNewTask starts a task in a project
 * @returns a handler for the element's `onContextMenu`
 */
export function useProjectContextMenu(onNewTask: (project: string) => void) {
  const openContextMenu = useContextMenu();
  return (event: MouseEvent, project: string) => {
    event.preventDefault();
    openContextMenu({
      at: { x: event.clientX, y: event.clientY },
      ...projectMenu(project, onNewTask),
    });
  };
}
