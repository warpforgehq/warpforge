import type { MouseEvent } from "react";

import { useContextMenu } from "@/hooks/useContextMenu";
import { usePins } from "@/store/pins";
import { spaceOfProject, useUi } from "@/store/ui";

import { useAddToSpace } from "./addToSpace";

/**
 * A project row's right-click menu: pin it, and put it in a space or open
 * the space it already belongs to.
 * @returns a handler for the row's `onContextMenu`
 */
export function useProjectContextMenu() {
  const openContextMenu = useContextMenu();
  return (event: MouseEvent, project: string) => {
    event.preventDefault();
    const pin = { id: project, kind: "project" } as const;
    const pinned = usePins.getState().has(pin);
    const space = spaceOfProject(project);
    openContextMenu({
      at: { x: event.clientX, y: event.clientY },
      items: [
        { type: "item", id: "pin", label: pinned ? "Unpin from rail" : "Pin to rail" },
        { type: "separator" },
        space
          ? { type: "item", id: "space", label: `Open space ${space.name}` }
          : { type: "item", id: "space", label: "Add to space…" },
      ],
      handlers: new Map([
        ["pin", () => usePins.getState().toggle(pin)],
        [
          "space",
          () =>
            space ? useUi.getState().openSpace(space.id) : useAddToSpace.getState().open(project),
        ],
      ]),
    });
  };
}
