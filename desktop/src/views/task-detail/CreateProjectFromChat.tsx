import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, FolderPlus, Loader2 } from "lucide-react";
import { useState } from "react";

import { ContinueSessionDialog } from "@/components/ContinueSessionDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { daemon } from "@/daemon";
import { useTaskSessionUpdates } from "@/hooks/useTaskSessionUpdates";
import type { TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";

/**
 * @param title The chat's title.
 * @returns A folder name for the project made from it.
 */
export function projectFolderName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug || "chat-project";
}

/**
 * @param path The folder typed or picked.
 * @returns Why it cannot be used, or null when the daemon should decide.
 */
export function projectPathError(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return "Choose a folder for the project.";
  if (!trimmed.startsWith("/") && trimmed !== "~" && !trimmed.startsWith("~/")) {
    return "Use a full path, like ~/workspace/notes.";
  }
  if (trimmed.split("/").includes("..")) return "Remove the .. from the path.";
  return null;
}

/**
 * Copies a chat's files into a new folder, registers it as a project, then
 * hands the conversation to a new task there through the continue dialog.
 * @param props.task The chat.
 * @returns The button, its dialog, and the continue dialog once created.
 */
export function CreateProjectFromChat({ task }: { task: TaskInfo }) {
  const updates = useTaskSessionUpdates(task.id);
  const openTask = useUi((s) => s.openTask);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ name: string; path: string } | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={updates.length === 0}
        onClick={() => setOpen(true)}
        className="flex h-5 items-center gap-1 rounded px-1.5 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      >
        <FolderPlus aria-hidden className="size-3" />
        Create project from chat…
      </button>
      {open && (
        <CreateProjectDialog
          task={task}
          onOpenChange={setOpen}
          onCreated={(project) => {
            setOpen(false);
            setCreated(project);
          }}
        />
      )}
      {created && (
        <ContinueSessionDialog
          open
          onOpenChange={(next) => {
            if (!next) setCreated(null);
          }}
          task={task}
          updates={updates}
          throughIndex={updates.length - 1}
          targetAgent={task.agent}
          targetProject={created.name}
          targetFolder={created.path}
          onOpenTask={openTask}
        />
      )}
    </>
  );
}

/**
 * @param props.task The chat.
 * @param props.onOpenChange Closes the dialog.
 * @param props.onCreated Called with the registered project.
 * @returns The folder and git choices for the new project.
 */
export function CreateProjectDialog({
  task,
  onOpenChange,
  onCreated,
}: {
  task: TaskInfo;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: { name: string; path: string }) => void;
}) {
  const folderName = projectFolderName(task.title);
  const [path, setPath] = useState(`~/workspace/${folderName}`);
  const [initGit, setInitGit] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const browse = async () => {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Where to create the project",
    });
    if (typeof picked === "string") setPath(`${picked.replace(/\/+$/, "")}/${folderName}`);
  };

  const create = async () => {
    const invalid = projectPathError(path);
    setError(invalid);
    if (invalid || busy) return;
    setBusy(true);
    try {
      onCreated(await daemon.createProjectFromChat(task.id, path.trim(), initGit));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create project from chat</DialogTitle>
          <DialogDescription>
            Copies the chat&apos;s files into a new folder, without node_modules or .venv, and
            continues the conversation there. The chat keeps its own copy.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <label
              htmlFor="chat-project-path"
              className="mb-1 block text-[13px] font-medium text-muted-foreground"
            >
              Project folder
            </label>
            <div className="flex gap-2">
              <input
                id="chat-project-path"
                type="text"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void create();
                }}
                className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <Button variant="outline" size="sm" onClick={() => void browse()}>
                <FolderOpen className="mr-1 size-4" />
                Browse
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              A new folder, or an empty one. A folder with files in it is never merged into.
            </p>
          </div>

          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <input
              type="checkbox"
              checked={initGit}
              onChange={(event) => setInitGit(event.target.checked)}
              className="size-3.5 accent-[hsl(var(--primary))]"
            />
            Initialize git
          </label>

          {error && <p className="text-[13px] text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !path.trim()} onClick={() => void create()}>
            {busy && <Loader2 className="mr-1 size-4 animate-spin" />}
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
