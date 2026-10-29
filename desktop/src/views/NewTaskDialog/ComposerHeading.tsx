import { FolderPlus, MessageSquare, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ProjectBadge } from "@/components/Sidebar/ProjectBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { Snapshot } from "../../protocol";

/**
 * The composer's title, naming the project the task runs in; the name is the
 * project picker unless the project is fixed.
 * @param props.project The selected project, empty when none exists.
 * @param props.projects The registered projects.
 * @param props.locked Whether the project cannot be changed here.
 * @param props.onChange Called with the newly picked project.
 * @param props.onAddProject Opens Add project; absent, the picker offers none.
 * @param props.chat Whether "No project" is picked.
 * @param props.onNoProject Picks "No project"; absent, the picker offers none.
 * @returns The heading element.
 */
export function ComposerHeading({
  project,
  projects,
  locked,
  onChange,
  onAddProject,
  chat = false,
  onNoProject,
}: {
  project: string;
  projects: Snapshot["projects"];
  locked: boolean;
  onChange: (next: string) => void;
  onAddProject?: () => void;
  chat?: boolean;
  onNoProject?: () => void;
}) {
  if (!project && !onAddProject && !onNoProject) {
    return <h1 className={HEADING}>What should we build?</h1>;
  }
  const picker = locked ? (
    project
  ) : (
    <ProjectPicker
      project={project}
      projects={projects}
      chat={chat}
      onChange={onChange}
      onAddProject={onAddProject}
      onNoProject={onNoProject}
    />
  );
  return (
    <h1 className={HEADING}>
      {chat ? "What should we work on " : "What should we build in "}
      {picker}?
    </h1>
  );
}

const HEADING = "max-w-full text-center text-2xl font-semibold tracking-tight";

function ProjectPicker({
  project,
  projects,
  chat,
  onChange,
  onAddProject,
  onNoProject,
}: {
  project: string;
  projects: Snapshot["projects"];
  chat: boolean;
  onChange: (next: string) => void;
  onAddProject?: () => void;
  onNoProject?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = projects.find((candidate) => candidate.name === project);

  useEffect(() => {
    if (!open) return;
    // The menu focuses itself on open; the search box has to win after that.
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const needle = search.trim().toLowerCase();
  const visible = needle
    ? projects.filter((candidate) => candidate.name.toLowerCase().includes(needle))
    : projects;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSearch("");
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Project"
          title={
            selected
              ? `${selected.path} · ports ${selected.portRange[0]}–${selected.portRange[1]}`
              : chat
                ? "Runs in its own folder, outside any project"
                : "Choose a project"
          }
          className="rounded-sm underline decoration-muted-foreground/50 decoration-2 underline-offset-[6px] transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {chat ? "without a project" : project || "a project"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-0 text-left tracking-normal">
        {projects.length > 0 && (
          <label className="flex items-center gap-2 border-b px-2 py-1.5">
            <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              // Typed letters would otherwise jump focus to a matching item.
              onKeyDown={(event) => {
                if (event.key !== "Escape") event.stopPropagation();
              }}
              placeholder="Search projects"
              aria-label="Search projects"
              className="min-w-0 flex-1 bg-transparent text-[13px] font-normal outline-none placeholder:text-muted-foreground"
            />
          </label>
        )}
        <div className="max-h-72 overflow-y-auto p-1">
          {visible.map((candidate) => (
            <DropdownMenuItem
              key={candidate.name}
              className={cn("text-[13px]", candidate.name === project && "bg-secondary/60")}
              onSelect={() => onChange(candidate.name)}
            >
              <ProjectBadge name={candidate.name} />
              <span className="truncate">{candidate.name}</span>
            </DropdownMenuItem>
          ))}
          {needle && visible.length === 0 && (
            <p className="px-2 py-1.5 text-[13px] text-muted-foreground">No matches</p>
          )}
          {onNoProject && (
            <>
              {projects.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                className={cn("text-[13px]", chat && "bg-secondary/60")}
                onSelect={onNoProject}
              >
                <MessageSquare aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                No project
              </DropdownMenuItem>
            </>
          )}
          {onAddProject && (
            <>
              {(projects.length > 0 || onNoProject) && <DropdownMenuSeparator />}
              <DropdownMenuItem className="text-[13px]" onSelect={onAddProject}>
                <FolderPlus aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                Add project
              </DropdownMenuItem>
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
