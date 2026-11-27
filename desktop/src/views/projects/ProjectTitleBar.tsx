import { ChevronDown, EllipsisVertical, Factory, Pencil, Plus, Square, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectInfo } from "@/protocol";
import { useTitleRow } from "@/store/titleRow";
import type { ProjectSurface } from "@/store/ui";

import { PortRangeSourceChip } from "./PortRangeStatus";
import { PROJECT_SECTIONS, sectionLabel } from "./sections";

interface Props {
  project: ProjectInfo;
  section: ProjectSurface;
  /** The panel is hidden, so the title doubles as the section picker. */
  sectionPicker: boolean;
  onSection: (section: ProjectSurface) => void;
  onNewWorkItem: () => void;
  onFactorySettings: () => void;
  onStopAll: () => void;
  onRemove: () => void;
}

/**
 * A project section's title and actions, portalled into the window's title
 * row the way a task's side pane header is.
 */
export function ProjectTitleBar({
  project,
  section,
  sectionPicker,
  onSection,
  onNewWorkItem,
  onFactorySettings,
  onStopAll,
  onRemove,
}: Props) {
  const slot = useTitleRow((state) => state.projectSlot);
  if (!slot) return null;

  const title = <h1 className="truncate text-[1rem] font-semibold">{sectionLabel(section)}</h1>;

  return createPortal(
    <>
      {sectionPicker ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Switch section"
              className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {title}
              <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {PROJECT_SECTIONS.map(({ id, label, icon: Icon }) => (
              <DropdownMenuItem key={id} onSelect={() => onSection(id)} className="gap-2">
                <Icon className="size-4 text-muted-foreground" />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="min-w-0 px-1">{title}</div>
      )}
      <span className="flex-1" />
      {section === "backlog" && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`New work item in ${project.name}`}
          onClick={onNewWorkItem}
        >
          <Plus className="size-3.5" />
          New work item
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Project menu"
            title={`Actions for ${project.name}`}
            className="w-7 px-0 text-muted-foreground"
          >
            <EllipsisVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-1 font-normal">
            <span className="truncate text-[0.75rem] text-muted-foreground" title={project.path}>
              {project.path}
            </span>
            <span className="flex items-center gap-1.5 text-[0.75rem] tabular-nums text-muted-foreground">
              Ports {project.portRange[0]}–{project.portRange[1]}
              <PortRangeSourceChip project={project} />
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onFactorySettings}>
            <Factory className="size-4" />
            Factory settings…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onStopAll}>
            <Square className="size-4" />
            Stop all Factory tasks
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onRemove}>
            <Trash2 className="size-4" />
            Remove project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>,
    slot,
  );
}
