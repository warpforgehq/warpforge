import { create } from "zustand";

import { daemon } from "@/daemon";
import type { Space } from "@/protocol";
import { spaceOfProject } from "@/store/ui";

/** The project the Add to space dialog is open for. Transient. */
export const useAddToSpace = create<{
  project: string | null;
  /** Open straight on "New space…". */
  newSpace: boolean;
  open: (project: string, newSpace?: boolean) => void;
  close: () => void;
}>()((set) => ({
  project: null,
  newSpace: false,
  open: (project, newSpace = false) => set({ newSpace, project }),
  close: () => set({ newSpace: false, project: null }),
}));

/**
 * Put a project into a space, taking it out of the one it is in first: the
 * daemon refuses a project in two spaces.
 * @param project the project name
 * @param spaceId the space to move it to
 * @param spaces the spaces as they are now
 */
export async function moveProjectToSpace(
  project: string,
  spaceId: string,
  spaces: Space[],
): Promise<void> {
  const current = spaceOfProject(project, spaces);
  if (current?.id === spaceId) return;
  if (current) await daemon.removeSpaceMember(current.id, { kind: "project", name: project });
  await daemon.addSpaceMember(spaceId, { kind: "project", name: project });
}
