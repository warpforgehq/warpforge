import { Brain, CircleDashed, FileText, PenLine, Search, Terminal, Wrench, X } from "lucide-react";

import { getFileIconUrl } from "@/lib/fileIcon";
import type { ActivityCategory } from "@/lib/transcriptGroups";
import { cn } from "@/lib/utils";

import type { ToolCallStatus } from "../../protocol";

const ICON = "size-3.5 shrink-0";

/** What a group was for at a glance: look, change, run, think, other. */
export function CategoryIcon({
  category,
  className,
}: {
  category: ActivityCategory;
  className?: string;
}) {
  const shared = { className: cn(ICON, "text-muted-foreground", className), strokeWidth: 1.75 };
  switch (category) {
    case "read":
      return <FileText {...shared} />;
    case "search":
      return <Search {...shared} />;
    case "edit":
      return <PenLine {...shared} />;
    case "run":
      return <Terminal {...shared} />;
    case "think":
      return <Brain {...shared} />;
    default:
      return <Wrench {...shared} />;
  }
}

/**
 * A step's state: a dashed spinner while it runs, a red X when it failed, and
 * nothing at all once it completed. The absent trailing word is the single
 * biggest cut in transcript noise.
 */
export function ActivityStatusIcon({
  status,
  className,
}: {
  status: ToolCallStatus;
  className?: string;
}) {
  if (status === "failed") {
    return <X className={cn(ICON, "text-destructive", className)} strokeWidth={2} />;
  }
  if (status === "pending" || status === "in_progress") {
    return (
      <CircleDashed
        className={cn(
          ICON,
          "animate-spin text-muted-foreground motion-reduce:animate-none",
          className,
        )}
        strokeWidth={1.75}
      />
    );
  }
  return null;
}

/** The file-type mark in a path chip, falling back to a generic file glyph. */
export function FileTypeIcon({ path, className }: { path: string; className?: string }) {
  const url = getFileIconUrl(path);
  return url ? (
    <img src={url} alt="" aria-hidden className={cn(ICON, className)} />
  ) : (
    <FileText className={cn(ICON, "text-muted-foreground", className)} />
  );
}
