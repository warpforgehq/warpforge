import { Check, ChevronDown, Folder, FolderGit2 } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";

import AccountSwitcher from "@/components/AccountSwitcher";
import { TaskMenu } from "@/components/TaskMenu";
import { TaskTitleEditor } from "@/components/TaskTitleEditor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { daemon } from "@/daemon";
import { buildTaskGroupIndex, isTaskGroupPinned, setTaskGroupPinned } from "@/lib/taskGroups";
import type { TaskInfo } from "@/protocol";
import { useUi, type GlobalView, type View } from "@/store/ui";

const VIEW_LABEL: Record<GlobalView, string> = {
  automations: "Automations",
  control: "Mission Control",
  inbox: "Inbox",
};

interface AppHeaderProps {
  view: View;
  openTask: TaskInfo | null;
  onAddProject: () => void;
  onCloseTask: () => void;
}

/**
 * Global chrome: a breadcrumb row, plus the account switcher on views with no
 * single agent in focus. App update and daemon connection sit in the sidebar
 * footer/brand row, as do brand, navigation, New task and Settings.
 *
 * When a task is open, the breadcrumb's second segment becomes its (editable)
 * title with the workspace it runs in beside it, then the task menu. The task's
 * harness, account and quota live in the task footer, next to its git state.
 * Project and status are deliberately not repeated here: the sidebar already
 * establishes which project you're in, and status is one glance away in the
 * conversation itself. Navigating to another view (sidebar nav, or clicking
 * another task) closes this one — no separate back control needed.
 */
export default function AppHeader({ view, openTask, onAddProject, onCloseTask }: AppHeaderProps) {
  // Accounts come straight from the daemon rather than through App: the chip is
  // the only consumer, and threading them through every render of the shell
  // would couple unrelated views to account state.
  const { snapshot } = useSyncExternalStore(daemon.subscribe, daemon.getState);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const openProject = useUi((s) => s.openProject);
  const pinnedTaskIds = useUi((s) => s.pinnedTaskIds);
  const setPinnedTaskIds = useUi((s) => s.setPinnedTaskIds);
  const isProject = view === "project" && !openTask;
  const crumbProject =
    isProject && snapshot.projects.length > 0
      ? (snapshot.projects.find((p) => p.name === selectedProjectId) ?? snapshot.projects[0])
      : null;
  const taskGroupIndex = useMemo(() => buildTaskGroupIndex(snapshot.tasks), [snapshot.tasks]);
  const taskPinned = openTask
    ? isTaskGroupPinned(taskGroupIndex, pinnedTaskIds, openTask.id)
    : false;

  return (
    // `deep` so the whole row drags the window, not only its bare background —
    // the hidden native title bar no longer offers a drag handle. Tauri's
    // handler stops at buttons, inputs and anything with a role, so the
    // controls in this row still click.
    <header
      data-tauri-drag-region="deep"
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-2.5"
    >
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground"
      >
        <span className="text-[13px]">{openTask ? openTask.project : "Warpforge"}</span>
        <span aria-hidden className="text-[13px] text-muted-foreground/60">
          /
        </span>
        {openTask ? (
          <>
            <TaskTitleEditor task={openTask} />
            {/* Only worth saying when it is the unusual case. A task in the
                project's own checkout is the default, and a chip announcing
                "Local Workspace" on most tasks is a label nobody reads. */}
            {openTask.worktree && (
              <span
                className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground"
                title={openTask.worktree}
              >
                <Folder className="size-3 shrink-0" />
                Git Worktree
              </span>
            )}
          </>
        ) : view === "project" ? (
          <>
            {crumbProject && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Switch project"
                    className="flex min-w-0 max-w-56 items-center gap-1 rounded px-1 py-0.5 text-[15px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span className="truncate">{crumbProject.name}</span>
                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {snapshot.projects.map((p) => (
                    <DropdownMenuItem
                      key={p.name}
                      onSelect={() => openProject(p.name)}
                      className="gap-2"
                    >
                      <FolderGit2 className="size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {p.name === crumbProject.name && <Check className="size-4 text-primary" />}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onAddProject} className="gap-2">
                    <FolderGit2 className="size-4 text-muted-foreground" />
                    Add project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        ) : (
          <strong className="min-w-0 truncate text-[15px] font-medium text-foreground">
            {VIEW_LABEL[view]}
          </strong>
        )}
      </nav>

      {openTask && (
        <TaskMenu
          task={openTask}
          pinned={taskPinned}
          onTogglePin={() =>
            setPinnedTaskIds(
              setTaskGroupPinned(taskGroupIndex, pinnedTaskIds, openTask.id, !taskPinned),
            )
          }
          onClose={onCloseTask}
        />
      )}

      {/* Only relevant outside a task, and only where an agent is actually in
          play: an open task already shows its own harness's account chip in
          its footer, and a *different* agent's switcher here would just be
          account chrome for a tool this task doesn't use. Mission Control and
          Projects have no single agent in focus, so the full switcher belongs
          there. The inbox spends nobody's quota — its one agent action, "Send
          to agent", lands in a task that carries its own chip — so an account
          picker there is chrome for a decision the surface never makes. */}
      {!openTask && view !== "inbox" && (
        <div className="ml-auto">
          <AccountSwitcher agents={snapshot.agents ?? []} accounts={snapshot.accounts ?? []} />
        </div>
      )}
    </header>
  );
}
