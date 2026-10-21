import { Check, Home, Search } from "lucide-react";
import { useState } from "react";

import { ProjectBadge } from "@/components/Sidebar/ProjectBadge";
import { Input } from "@/components/ui/input";
import { type ProjectSelection, makeHome, toggleProject } from "@/lib/projectSelection";
import { cn } from "@/lib/utils";

/** Above this many projects the list gets a filter box. */
const SEARCH_FROM = 7;

interface Props {
  projects: string[];
  value: ProjectSelection;
  onChange: (value: ProjectSelection) => void;
  /** False where home cannot move (an existing Smith): it stays picked. */
  homeEditable?: boolean;
  label: string;
}

/**
 * A checkable list of projects with their badges. The first picked is the
 * home project, marked as such; another picked project can be made home.
 */
export function ProjectMultiSelect({
  projects,
  value,
  onChange,
  homeEditable = true,
  label,
}: Props) {
  const [query, setQuery] = useState("");
  const shown = query
    ? projects.filter((p) => p.toLowerCase().includes(query.toLowerCase()))
    : projects;
  return (
    <div className="rounded-md border border-input">
      {projects.length >= SEARCH_FROM && (
        <div className="flex items-center gap-1.5 border-b border-input px-2">
          <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            aria-label="Filter projects"
            placeholder="Filter projects"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
        </div>
      )}
      <ul role="group" aria-label={label} className="max-h-48 overflow-y-auto py-1">
        {shown.map((project) => {
          const picked = value.projects.includes(project);
          const home = value.home === project;
          const locked = home && !homeEditable;
          return (
            <li key={project} className="group flex items-center gap-2 px-2 py-1 text-[13px]">
              <button
                type="button"
                role="checkbox"
                aria-checked={picked}
                aria-disabled={locked || undefined}
                onClick={() => !locked && onChange(toggleProject(value, project))}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  locked && "cursor-default",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded border",
                    picked ? "border-primary bg-primary text-primary-foreground" : "border-input",
                  )}
                >
                  {picked && <Check className="size-3" />}
                </span>
                <ProjectBadge name={project} />
                <span className="truncate">{project}</span>
              </button>
              {home ? (
                <span className="flex shrink-0 items-center gap-1 text-xs text-primary">
                  <Home aria-hidden className="size-3" />
                  home
                </span>
              ) : (
                picked &&
                homeEditable && (
                  <button
                    type="button"
                    onClick={() => onChange(makeHome(value, project))}
                    className="hidden shrink-0 text-xs text-muted-foreground hover:text-foreground group-hover:inline-block group-focus-within:inline-block"
                  >
                    Make home
                  </button>
                )
              )}
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="px-2 py-1 text-xs text-muted-foreground">No project matches.</li>
        )}
      </ul>
    </div>
  );
}
