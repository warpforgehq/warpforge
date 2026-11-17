import { renderHook, fireEvent } from "@testing-library/react";
import { expect, it } from "vitest";

import type { TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";
import { useBranchNavigation } from "@/views/push/branchNavigation";

import { usePushShortcut } from "./usePushShortcut";

it("opens the task's Diff surface and Commits rail", () => {
  useUi.setState({ openTaskId: "t1", activeSurface: "files", diffPanelCollapsed: true });
  renderHook(() => usePushShortcut([{ id: "t1" } as TaskInfo]));
  fireEvent.keyDown(window, { key: "K", ctrlKey: true, shiftKey: true });
  expect(useUi.getState().activeSurface).toBe("diff");
  expect(useUi.getState().diffPanelCollapsed).toBe(false);
  expect(useBranchNavigation.getState().taskId).toBe("t1");
});
