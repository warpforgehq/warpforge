import { ChevronRight, TriangleAlert } from "lucide-react";
import { memo, useContext, useState } from "react";

import { Button } from "@/components/ui/button";
import { toolDisplayTitle } from "@/lib/toolDisplay";
import { basenameOf, type ActivityItem, toolTarget } from "@/lib/transcriptGroups";
import { cn } from "@/lib/utils";

import { daemon } from "../../daemon";
import type { EditHunk, SessionUpdate } from "../../protocol";
import { ThinkingBlock } from "../ThinkingBlock";
import { ActivityStatusIcon, CategoryIcon, FileTypeIcon } from "./ActivityIcons";
import { TranscriptRowContext, type TranscriptRowContextValue } from "./TranscriptRow";

type ToolCall = Extract<SessionUpdate, { kind: "tool_call" }>;
type FileEdit = Extract<SessionUpdate, { kind: "file_edit" }>;

const STEP = "flex min-w-0 items-center gap-1.5 py-1 text-[13px] leading-5";

function useTranscriptContext(): TranscriptRowContextValue {
  const shared = useContext(TranscriptRowContext);
  if (!shared) throw new Error("Activity step rendered outside its context");
  return shared;
}

/** Repo-relative path for display; never the machine-absolute `/Users/...`. */
function displayTarget(
  raw: string,
  resolve: (value: string) => string | null,
): { path: string | null; label: string; title: string } {
  const resolved = resolve(raw);
  if (resolved) return { label: basenameOf(resolved), path: resolved, title: resolved };
  const absolute = raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw);
  const label = basenameOf(raw);
  return { label, path: null, title: absolute ? label : raw };
}

function PathChip({ raw }: { raw: string }) {
  const shared = useTranscriptContext();
  const { path, label, title } = displayTarget(raw, shared.resolveFilePath);
  const body = (
    <>
      <FileTypeIcon path={label} />
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
  const className =
    "inline-flex min-w-0 max-w-[60%] items-center gap-1 rounded px-1 py-0.5 font-mono text-[12px]";
  if (!path) {
    return (
      <span className={className} title={title}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        shared.onOpenFile(path);
      }}
      className={cn(className, "text-muted-foreground hover:bg-accent/40 hover:text-foreground")}
    >
      {body}
    </button>
  );
}

function Diffstat({
  additions,
  deletions,
  path,
  hunks,
}: {
  additions: number;
  deletions: number;
  path: string | null;
  hunks?: EditHunk[];
}) {
  const shared = useTranscriptContext();
  const body = (
    <>
      <span className="text-ok">+{additions}</span>
      <span className="text-destructive">−{deletions}</span>
    </>
  );
  const className =
    "inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[12px] tabular-nums";
  const label = `${additions} lines added, ${deletions} lines deleted`;
  if (!path) {
    return (
      <span className={className} aria-label={label}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      title="Open diff"
      onClick={(event) => {
        event.stopPropagation();
        shared.onOpenFileDiff(path, hunks);
      }}
      className={cn(className, "hover:bg-accent/40")}
    >
      {body}
    </button>
  );
}

function ToolCallStep({
  update,
  category,
  bare,
}: {
  update: ToolCall;
  category: ActivityItem["category"];
  bare: boolean;
}) {
  const shared = useTranscriptContext();
  const [open, setOpen] = useState(false);
  const [clicked, setClicked] = useState<string | null>(null);
  const permission = update.pendingPermission;
  const answered = clicked ?? (permission ? shared.resolved[permission.request_id] : undefined);
  const awaiting = Boolean(permission) && !answered;
  const target = toolTarget(update);
  const hasContent = Boolean(update.content);
  // Only reads and edits name a file worth a chip; a command's label is its
  // own text, and a search's target is a query, not a path. The raw tool title
  // can carry a machine-absolute path, so it is never rendered directly.
  const chipped = (category === "read" || category === "edit") && Boolean(target);
  const label = chipped ? (category === "read" ? "Read" : "Edit") : toolDisplayTitle(update);

  return (
    <div className="flex min-w-0 flex-col">
      <div className={cn(STEP, awaiting && "text-warn")}>
        {!bare && <CategoryIcon category={category} />}
        <span className="min-w-0 flex-1 truncate text-foreground/80" title={label}>
          {label}
        </span>
        {chipped && target ? <PathChip raw={target} /> : null}
        <ActivityStatusIcon status={update.status} />
        {hasContent ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? "Hide output" : "Show output"}
            onClick={() => setOpen((value) => !value)}
            className="-m-1 shrink-0 rounded p-1"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
              strokeWidth={1.75}
            />
          </button>
        ) : null}
      </div>
      {awaiting && permission ? (
        <div className="flex flex-wrap items-center gap-1.5 py-1 pl-5">
          <TriangleAlert className="size-3.5 shrink-0 text-warn" />
          {shared.taskId
            ? permission.options.map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={option === "deny" ? "destructive" : "default"}
                  onClick={() => {
                    setClicked(option);
                    void daemon.request("session.permission", {
                      outcome: option,
                      request_id: permission.request_id,
                      task_id: shared.taskId,
                    });
                  }}
                >
                  {option.replace("_", " ")}
                </Button>
              ))
            : null}
        </div>
      ) : null}
      {open && update.content ? (
        <pre className="my-1 max-h-56 overflow-auto whitespace-pre-wrap break-words pl-5 font-mono text-[12px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          {update.content}
        </pre>
      ) : null}
    </div>
  );
}

function FileEditStep({ update }: { update: FileEdit }) {
  const shared = useTranscriptContext();
  const hasCounts = update.additions !== undefined || update.deletions !== undefined;
  return (
    <div className={STEP}>
      <PathChip raw={update.path} />
      {hasCounts ? (
        <Diffstat
          additions={update.additions ?? 0}
          deletions={update.deletions ?? 0}
          hunks={update.hunks}
          path={shared.resolveFilePath(update.path)}
        />
      ) : null}
    </div>
  );
}

function ThoughtStep({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const shared = useTranscriptContext();
  const firstLine =
    text
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? "Thinking";
  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "Hide thinking" : "Show thinking"}
        onClick={() => setOpen((value) => !value)}
        className={cn(STEP, "text-left")}
      >
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{firstLine}</span>
        <ChevronRight
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
          strokeWidth={1.75}
        />
      </button>
      {open ? (
        <div className="min-w-0 py-1">
          <ThinkingBlock
            text={text}
            streaming={streaming}
            resolveFilePath={shared.resolveFilePath}
            onOpenFile={shared.onOpenFile}
          />
        </div>
      ) : null}
    </div>
  );
}

export const ActivityGroupRow = memo(function ActivityGroupRow({
  item,
  bare = true,
  live = false,
}: {
  item: ActivityItem;
  bare?: boolean;
  live?: boolean;
}) {
  const update = item.entry.update;
  switch (update.kind) {
    case "agent_thought":
      return <ThoughtStep text={update.text} streaming={live} />;
    case "file_edit":
      return <FileEditStep update={update} />;
    case "tool_call":
      return <ToolCallStep update={update} bare={bare} category={item.category} />;
    default:
      return null;
  }
});
