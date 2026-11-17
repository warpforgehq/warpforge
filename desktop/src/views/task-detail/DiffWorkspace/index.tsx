import { forwardRef } from "react";

import { CommitWorkspace } from "./CommitWorkspace";
import {
  DiffWorkspace as WorkingWorkspace,
  type Props,
  type DiffWorkspaceHandle,
} from "./WorkingWorkspace";
export { estimateFileHeight } from "./WorkingWorkspace";
export type { DiffWorkspaceHandle } from "./WorkingWorkspace";

/** Historical patches never fetch working-tree file documents. */
export const DiffWorkspace = forwardRef<DiffWorkspaceHandle, Props & { historical?: boolean }>(
  function DiffWorkspace({ historical, ...props }, ref) {
    return historical ? (
      <CommitWorkspace ref={ref} {...props} />
    ) : (
      <WorkingWorkspace ref={ref} {...props} />
    );
  },
);
