// eslint-disable-next-line import/no-unassigned-import
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { getDB } from "./db";
import {
  deleteTask,
  flush,
  getProject,
  getTask,
  putProject,
  putTask,
  resetPendingForTests,
  resetRegistryForTests,
} from "./index";
import {
  ensureProject,
  ensureTask,
  forgetProject,
  forgetTask,
  isTaskLoaded,
  loadTask,
  pruneTaskDiff,
  setProjectFiles,
  setTaskDiff,
  setTaskDiffHunkPosition,
  setTaskEditorView,
  setTaskFiles,
  setTaskFind,
  setTaskSurface,
  subscribeTask,
} from "./registry";
import {
  DB_NAME,
  MAX_TASK_SESSIONS,
  emptyProjectSession,
  emptyTaskSession,
  preferredActivePath,
  pruneViews,
  type TaskWorkspaceSession,
} from "./types";

async function clearDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  resetPendingForTests();
  resetRegistryForTests();
  const { resetDBForTests } = await import("./db");
  await resetDBForTests();
  await clearDatabase();
});

describe("session store round trip", () => {
  it("writes a task session, debounces, and reads it back", async () => {
    const session = emptyTaskSession("task-1", "warpforge");
    session.files.tabs = ["src/app.rs"];
    session.files.activePath = "src/app.rs";
    putTask(session);

    // Not flushed yet: the write is debounced off the hot path.
    expect(await getTask("task-1")).toBeNull();

    await flush();
    const stored = await getTask("task-1");
    expect(stored?.taskId).toBe("task-1");
    expect(stored?.files.tabs).toEqual(["src/app.rs"]);
  });

  it("coalesces repeated writes to the latest value", async () => {
    const session = emptyTaskSession("task-2", "warpforge");
    putTask({ ...session, activeSurface: "files" });
    putTask({ ...session, activeSurface: "runtime" });
    putTask({ ...session, activeSurface: "terminal" });

    await flush();

    expect((await getTask("task-2"))?.activeSurface).toBe("terminal");
  });

  it("keeps task and project records separate", async () => {
    putTask(emptyTaskSession("task-3", "alpha"));
    putProject(emptyProjectSession("alpha"));
    await flush();

    expect(await getTask("task-3")).not.toBeNull();
    expect(await getProject("alpha")).not.toBeNull();
  });

  it("deletes a session on request", async () => {
    putTask(emptyTaskSession("task-4", "warpforge"));
    await flush();
    await deleteTask("task-4");
    expect(await getTask("task-4")).toBeNull();
  });
});

describe("eviction", () => {
  it("drops records past the TTL and caps the store at its LRU limit", async () => {
    const db = await getDB();
    if (!db) throw new Error("indexedDB unavailable");
    const now = Date.now();
    expect(MAX_TASK_SESSIONS).toBe(100);

    for (let i = 0; i < MAX_TASK_SESSIONS + 5; i += 1) {
      const session = emptyTaskSession(`old-${i}`, "warpforge");
      session.updatedAt = now - 200 * 24 * 60 * 60 * 1000 - i;
      await db.put("tasks", session);
    }
    const fresh = emptyTaskSession("fresh", "warpforge");
    fresh.updatedAt = now;
    await db.put("tasks", fresh);

    const { sweep } = await import("./db");
    await sweep(db);

    // TTL removed every record older than 90 days, so only the fresh one is left.
    expect(await db.get("tasks", "old-0")).toBeUndefined();
    expect(await db.get("tasks", "fresh")).toBeDefined();
  });
});

describe("restore precedence and stale paths", () => {
  it("keeps the stored active path when it still exists", () => {
    const result = preferredActivePath(
      ["a.rs", "b.rs"],
      "a.rs",
      new Set(["a.rs", "b.rs", "c.rs"]),
    );
    expect(result.activePath).toBe("a.rs");
    expect(result.tabs).toEqual(["a.rs", "b.rs"]);
  });

  it("falls back to the last valid tab when the active path is gone", () => {
    const result = preferredActivePath(
      ["gone.rs", "b.rs", "c.rs"],
      "gone.rs",
      new Set(["b.rs", "c.rs"]),
    );
    expect(result.activePath).toBe("c.rs");
    expect(result.tabs).toEqual(["b.rs", "c.rs"]);
  });

  it("does not resurrect a file that no longer exists", () => {
    const result = preferredActivePath(["gone.rs"], "gone.rs", new Set(["other.rs"]));
    expect(result.activePath).toBeNull();
    expect(result.tabs).toEqual([]);
  });

  it("drops view records whose path is no longer listed", () => {
    const views = {
      "a.rs": { anchor: 0, head: 0, path: "a.rs", scrollLeft: 0, scrollTop: 10, updatedAt: 1 },
      "gone.rs": { anchor: 0, head: 0, path: "gone.rs", scrollLeft: 0, scrollTop: 10, updatedAt: 1 },
    };
    expect(Object.keys(pruneViews(views, new Set(["a.rs"])))).toEqual(["a.rs"]);
  });
});

describe("registry scope isolation", () => {  it("does not share tabs between projects", () => {
    setProjectFiles("alpha", { activePath: "a.rs", tabs: ["a.rs"] });
    setProjectFiles("beta", { activePath: "b.rs", tabs: ["b.rs"] });

    expect(ensureProject("alpha").files.tabs).toEqual(["a.rs"]);
    expect(ensureProject("beta").files.tabs).toEqual(["b.rs"]);
  });

  it("does not share a task session merely because project names match", async () => {
    putTask({
      ...emptyTaskSession("task-x", "warpforge", "/worktree-a"),
      activeSurface: "files",
    });
    await flush();

    // Same id, different worktree: the stored session must not be inherited.
    const loaded = await loadTask("task-x", "warpforge", "/worktree-b");
    expect(loaded.activeSurface).toBe("diff");
    expect(loaded.worktree).toBe("/worktree-b");
  });

  it("notifies subscribers and marks a scope loaded", async () => {
    let notifications = 0;
    const unsubscribe = subscribeTask("task-s", () => {
      notifications += 1;
    });
    setTaskFiles("task-s", "warpforge", { tabs: ["x.rs"] });
    await flush();

    expect(notifications).toBeGreaterThan(0);
    expect(ensureTask("task-s", "warpforge").files.tabs).toEqual(["x.rs"]);
    unsubscribe();
  });

  it("forgets a project's session on removal", async () => {
    setProjectFiles("gone", { tabs: ["x.rs"] });
    await flush();
    expect(await getProject("gone")).not.toBeNull();
    forgetProject("gone");
    await flush();
    expect(await getProject("gone")).toBeNull();
  });

  it("tracks loaded state per task", async () => {
    const session: TaskWorkspaceSession = emptyTaskSession("task-l", "warpforge");
    putTask(session);
    await flush();
    await loadTask("task-l", "warpforge");
    expect(isTaskLoaded("task-l")).toBe(true);
  });
});

describe("task session restore", () => {
  it("round-trips surface, tabs, cursor and find state through a reload", async () => {
    setTaskSurface("task-r", "warpforge", "files");
    setTaskFiles("task-r", "warpforge", {
      activePath: "src/app.rs",
      tabs: ["src/app.rs", "src/lib.rs"],
    });
    setTaskEditorView("task-r", "warpforge", "src/app.rs", {
      anchor: 42,
      head: 47,
      scrollLeft: 1,
      scrollTop: 300,
    });
    setTaskFind("task-r", "warpforge", { activeIndex: 2, query: "retry", updatedAt: Date.now() });
    await flush();

    // Simulate a reload: drop the in-memory cache, re-read from IndexedDB.
    resetRegistryForTests();
    const loaded = await loadTask("task-r", "warpforge");

    expect(loaded.activeSurface).toBe("files");
    expect(loaded.files.tabs).toEqual(["src/app.rs", "src/lib.rs"]);
    expect(loaded.files.activePath).toBe("src/app.rs");
    expect(loaded.files.views["src/app.rs"]?.anchor).toBe(42);
    expect(loaded.files.views["src/app.rs"]?.scrollTop).toBe(300);
    expect(loaded.findInFiles?.query).toBe("retry");
    expect(loaded.findInFiles?.activeIndex).toBe(2);
  });

  it("keeps a write made before the stored read resolves", async () => {
    putTask(emptyTaskSession("task-race", "warpforge"));
    await flush();

    // The user types/opens before `loadTask` finishes; the stored read must not
    // overwrite that in-memory intent.
    setTaskFind("task-race", "warpforge", {
      activeIndex: 0,
      query: "typed-early",
      updatedAt: Date.now(),
    });
    const loaded = await loadTask("task-race", "warpforge");

    expect(loaded.findInFiles?.query).toBe("typed-early");
  });

  it("no-ops a cursor write whose position did not change", () => {    setTaskEditorView("task-n", "warpforge", "a.rs", { anchor: 1, head: 1 });
    const first = ensureTask("task-n", "warpforge").files.views["a.rs"];
    setTaskEditorView("task-n", "warpforge", "a.rs", { anchor: 1, head: 1 });
    expect(ensureTask("task-n", "warpforge").files.views["a.rs"]).toBe(first);
  });

  it("records a hunk position once and keeps it stable", () => {
    setTaskDiffHunkPosition("task-h", "warpforge", "a.rs", "1:2:1:2");
    const first = ensureTask("task-h", "warpforge").diff.positions["a.rs"];
    setTaskDiffHunkPosition("task-h", "warpforge", "a.rs", "1:2:1:2");
    expect(ensureTask("task-h", "warpforge").diff.positions["a.rs"]).toBe(first);
  });

  it("prunes diff state for files the diff no longer reports", async () => {
    setTaskDiffHunkPosition("task-p", "warpforge", "gone.rs", "1:1:1:1");
    setTaskFiles("task-p", "warpforge", { activePath: "gone.rs", tabs: ["gone.rs"] });
    setTaskDiff("task-p", "warpforge", { collapsedFiles: ["gone.rs", "kept.rs"] });
    await flush();

    pruneTaskDiff("task-p", new Set(["kept.rs"]));

    const session = ensureTask("task-p", "warpforge");
    expect(session.diff.positions["gone.rs"]).toBeUndefined();
    expect(session.diff.collapsedFiles).toEqual(["kept.rs"]);
    expect(session.diff.selectedFile).toBeNull();
  });
});

describe("task deletion cleanup", () => {
  it("deletes a task's stored session on removal", async () => {
    putTask(emptyTaskSession("task-doomed", "warpforge"));
    await flush();
    expect(await getTask("task-doomed")).not.toBeNull();

    forgetTask("task-doomed");
    await flush();

    expect(await getTask("task-doomed")).toBeNull();
    expect(ensureTask("task-doomed", "warpforge").files.tabs).toEqual([]);
  });
});
