import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import AppHeader from "@app/components/AppHeader";
import Sidebar from "@app/components/Sidebar";
import { TooltipProvider } from "@app/components/ui/tooltip";
import { daemon } from "@app/daemon";
import { runnerStatusKey } from "@app/hooks/useRunner";
import { DEFAULT_INBOX_FILTERS } from "@app/lib/inboxFilters";
import { usePrFeedbackStore } from "@app/store/prFeedback";
import { DEFAULT_TASK_SURFACE, SIDEBAR_WIDTH_MIN, useUi } from "@app/store/ui";
import InboxView from "@app/views/InboxView";
import TaskDetail from "@app/views/TaskDetail";

import { sceneById, type Scene } from "./scenes";

/** How long the finished run stays on screen before the demo replays. */
const REPLAY_PAUSE_MS = 6000;

/**
 * The demo's own query client, rather than the app's exported one.
 *
 * Components read the client off React context, so nothing here needs the
 * app's instance — and borrowing it would drag a nominal type across the two
 * package trees, which ends with the checker and the bundler disagreeing about
 * how many query clients exist. Nothing is fetched over a network here, so
 * there is nothing to retry and nothing to go stale.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false, staleTime: 0 } },
});

/**
 * Put the world back to where `scene` starts.
 *
 * Demo mode's reseed covers the snapshot and the transcripts. Pull requests,
 * cached queries and the PR-feedback marks live outside it, so they are reset
 * here — through the reducer for the pull requests, as a daemon would. A
 * replay resets navigation only, so the tab a visitor picked survives it.
 */
function startScene(scene: Scene, replay = false) {
  for (const taskId of Object.keys(daemon.getState().taskPullRequests ?? {})) {
    daemon.demoEvent({ data: { pull_request: null, task_id: taskId }, event: "task.pullRequest" });
  }
  usePrFeedbackStore.setState({ handledByTask: {} });
  daemon.enableDemoMode(scene.seed());
  void queryClient.resetQueries(replay ? { queryKey: ["runner"] } : undefined);
  const nav = {
    inboxSelectedKey: null,
    openTaskId: scene.openTaskId,
    sidebarMode: "tasks",
    view: "control",
  } as const;
  if (replay) {
    useUi.setState(nav);
    return;
  }
  // The app's own defaults, minus the two that only make sense at desk
  // width: side-by-side diff needs more room than this frame has, and the
  // nav rail is wound down to the narrowest the app itself allows.
  useUi.setState({
    ...nav,
    diffView: "unified",
    inboxFilters: DEFAULT_INBOX_FILTERS,
    // The editor offers to install a language server when it cannot attach
    // one, which it never can here. The app's own off switch avoids the nag.
    lspEnabled: false,
    openTaskNav: null,
    sidebarWidth: SIDEBAR_WIDTH_MIN,
    ...scene.ui,
  });
}

/**
 * Answer the scene's own RPCs ahead of demo mode.
 *
 * `task.pullRequests` replaces the client's whole pull-request map with its
 * reply, and demo mode answers `{}`, so it echoes the map the scene's events
 * built — otherwise opening a task would wipe its PR chip.
 */
function serveScene(scene: () => Scene) {
  const inner = daemon.request.bind(daemon);
  daemon.request = (method: string, params?: unknown) => {
    const answered = scene().request?.(method, params);
    if (answered) return answered;
    if (method === "task.pullRequests") {
      return Promise.resolve({ pullRequests: daemon.getState().taskPullRequests ?? {} });
    }
    return inner(method, params);
  };
}

/** The landing page picks a scene through the frame's URL fragment. */
const sceneInHash = () => sceneById(window.location.hash.slice(1));

/**
 * The landing page's demo: the desktop app, running on the page.
 *
 * Not a mock-up of the app — the app. `Sidebar`, `AppHeader`, `TaskDetail`
 * and `InboxView` are imported straight out of `desktop/src`, and the only
 * thing swapped is what they read from: `daemon.enableDemoMode` seeds the
 * store and serves the reads, and each scene replays a run through the real
 * reducer.
 *
 * The upside is that this can never drift into a flattering lie — if a pill or
 * a diff row looks a certain way here, that is how the product looks. The cost
 * is that a refactor in `desktop/src` can break this build, which is the
 * trade we want: the website noticing is better than the website lying.
 */
export default function AppDemo() {
  const { snapshot: live } = useSyncExternalStore(daemon.subscribe, daemon.getState);
  const [scene, setScene] = useState(sceneInHash);
  const openTaskId = useUi((s) => s.openTaskId);
  const view = useUi((s) => s.view);
  const sidebarMode = useUi((s) => s.sidebarMode);

  const current = useRef(scene);
  current.current = scene;

  // Seed before first paint so the shell never flashes an empty state.
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    serveScene(() => current.current);
    startScene(scene);
  }

  // `useRunnerEvents`, against the demo's own client: the hook's parameter is
  // typed with the app's copy of React Query, which this client is not.
  useEffect(
    () =>
      daemon.subscribeEvents((event) => {
        if (event.event !== "runner.updated") return;
        queryClient.setQueryData(runnerStatusKey(event.data.settings.project), event.data);
      }),
    [],
  );

  useEffect(() => {
    const handler = () => setScene(sceneInHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  // Receive theme from parent landing page
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== "wf-theme" || !e.data?.theme) return;
      const t = e.data.theme as { colors: Record<string,string>; mode: string; id: string };
      const root = document.documentElement;
      for (const [k, v] of Object.entries(t.colors)) root.style.setProperty(`--${k}`, v);
      root.dataset.theme = t.id;
      root.classList.toggle("dark", t.mode === "dark");
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Run the script, hold on the finished state, then start over. Timers are
  // chained rather than scheduled up front so a paused background tab resumes
  // where it left off instead of firing the rest of the run at once.
  const started = useRef(scene);
  useEffect(() => {
    if (started.current !== scene) {
      started.current = scene;
      startScene(scene);
    }
    // A scene that opens a file forces the Files surface on the way through,
    // which is not where its story starts. Put it back once consumed.
    const frame = requestAnimationFrame(() =>
      useUi.setState({ activeSurface: scene.surface ?? DEFAULT_TASK_SURFACE }),
    );
    let beats = scene.script();
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const step = (index: number) => {
      if (cancelled) return;
      if (index === beats.length) {
        timer = setTimeout(() => {
          if (cancelled) return;
          startScene(scene, true);
          beats = scene.script();
          step(0);
        }, scene.hold ?? REPLAY_PAUSE_MS);
        return;
      }
      const beat = beats[index];
      timer = setTimeout(() => {
        if ("event" in beat) daemon.demoEvent(beat.event);
        else useUi.setState(beat.ui);
        step(index + 1);
      }, beat.after);
    };
    step(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [scene]);

  // Keep the open task's subtasks expanded so its sub-agents are visible.
  // The twisty is `button[data-expand="<task id>"]` (SidebarTaskRow.tsx).
  useEffect(() => {
    const tryExpand = () => {
      const btn = document.querySelector<HTMLButtonElement>(
        `button[data-expand="${scene.openTaskId}"]`,
      );
      if (btn && btn.getAttribute("aria-expanded") === "false") { btn.click(); return true; }
      return false;
    };
    if (tryExpand()) return;
    const id = setInterval(() => { if (tryExpand()) clearInterval(id); }, 300);
    const timeout = setTimeout(() => clearInterval(id), 6000);
    return () => { clearInterval(id); clearTimeout(timeout); };
  }, [scene]);

  const openTask = live.tasks.find((task) => task.id === openTaskId) ?? null;
  const projectNames = live.projects.map((project) => project.name);
  const openTaskInDemo = (id: string) => useUi.getState().openTask(id);
  const noop = () => {};

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <div
          className="flex h-full w-full overflow-hidden bg-background text-foreground"
        >
          <aside style={{ width: SIDEBAR_WIDTH_MIN }}
            className="flex shrink-0 flex-col overflow-hidden">
            <Sidebar
              collapsed={false}
              connection="connected"
              mode={sidebarMode}
              onAddProject={noop}
              onNewTask={noop}
              onOpenProject={noop}
              onOpenSettings={noop}
              onOpenTask={openTaskInDemo}
              onSelectMode={noop}
              onSelectView={noop}
              onToggleCollapsed={noop}
              openTaskId={openTaskId}
              state={daemon.getState()}
              view={view}
            />
          </aside>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <AppHeader
              onAddProject={noop}
              onCloseTask={noop}
              openTask={openTask}
              view={view}
            />
            <main className="min-h-0 flex-1 overflow-hidden p-2">
              {openTask ? (
                <TaskDetail
                  key={openTask.id}
                  onOpenPush={noop}
                  onOpenTask={openTaskInDemo}
                  snapshot={live}
                  task={openTask}
                />
              ) : view === "inbox" ? (
                <InboxView
                  listInSidebar={sidebarMode === "inbox"}
                  onAddProject={noop}
                  projects={projectNames}
                />
              ) : null}
            </main>
          </div>
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
