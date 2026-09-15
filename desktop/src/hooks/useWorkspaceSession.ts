import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
  ensureProject,
  ensureTask,
  isProjectLoaded,
  isTaskLoaded,
  loadProject,
  loadTask,
  subscribeProject,
  subscribeTask,
  type ProjectWorkspaceSession,
  type TaskWorkspaceSession,
} from "@/lib/sessionStore";
import type { TaskInfo } from "@/protocol";

export interface TaskSessionHandle {
  session: TaskWorkspaceSession;
  /** True once the persisted record has been read (or storage proved absent). */
  ready: boolean;
}

/** Shared, identity-checked task session. Writes go through the registry. */
export function useTaskSession(task: TaskInfo): TaskSessionHandle {
  const worktree = task.worktree ?? undefined;
  const get = useCallback(
    () => ensureTask(task.id, task.project, worktree),
    [task.id, task.project, worktree],
  );
  const subscribe = useCallback((listener: () => void) => subscribeTask(task.id, listener), [task.id]);
  const session = useSyncExternalStore(subscribe, get, get);
  const [ready, setReady] = useState(() => isTaskLoaded(task.id));

  useEffect(() => {
    setReady(isTaskLoaded(task.id));
    let active = true;
    void loadTask(task.id, task.project, worktree).then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [task.id, task.project, worktree]);

  return { ready, session };
}

export interface ProjectSessionHandle {
  session: ProjectWorkspaceSession;
  ready: boolean;
}

/** Shared, identity-checked project session. Writes go through the registry. */
export function useProjectSession(project: string, rootPath?: string): ProjectSessionHandle {
  const get = useCallback(() => ensureProject(project, rootPath), [project, rootPath]);
  const subscribe = useCallback(
    (listener: () => void) => subscribeProject(project, listener),
    [project],
  );
  const session = useSyncExternalStore(subscribe, get, get);
  const [ready, setReady] = useState(() => isProjectLoaded(project));

  useEffect(() => {
    setReady(isProjectLoaded(project));
    let active = true;
    void loadProject(project, rootPath).then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [project, rootPath]);

  return { ready, session };
}
