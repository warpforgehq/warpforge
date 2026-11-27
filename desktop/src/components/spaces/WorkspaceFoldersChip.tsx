import { Folder, FolderGit2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TaskInfo } from "@/protocol";

/**
 * "+N repos": the sibling folders this task's agent was given, so it is clear
 * what the agent can see beyond its own project.
 * @param task the open task
 * @returns the chip, or nothing outside a space
 */
export function WorkspaceFoldersChip({ task }: { task: TaskInfo }) {
  const folders = task.workspaceFolders ?? [];
  if (folders.length === 0) return null;
  const label = `+${folders.length} ${folders.length === 1 ? "repo" : "repos"}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: folders this task's agent can see`}
          title="Folders this task's agent can see"
          className="flex h-6 shrink-0 items-center rounded-control px-1.5 text-[0.75rem] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-[0.75rem] font-normal text-muted-foreground">
          Besides {task.project}, the agent can see
        </DropdownMenuLabel>
        {folders.map((folder) => (
          <DropdownMenuItem key={folder.path} className="items-start gap-2" title={folder.path}>
            {folder.git ? (
              <FolderGit2 className="mt-0.5 size-4 text-muted-foreground" />
            ) : (
              <Folder className="mt-0.5 size-4 text-muted-foreground" />
            )}
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{folder.name}</span>
              <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">
                {folder.path}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
          Captured when the task started. Edits there land in each repo's main checkout and do not
          appear in Changes.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
