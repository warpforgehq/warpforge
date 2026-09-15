import { ChevronRight, TriangleAlert } from "lucide-react";
import { memo, useContext, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { toolDisplayTitle } from "@/lib/toolDisplay";
import { basenameOf, type ActivityItem, toolTarget } from "@/lib/transcriptGroups";
import { cn } from "@/lib/utils";

import { daemon } from "../../daemon";
import type { EditHunk, SessionUpdate } from "../../protocol";
import { ThinkingBlock } from "../ThinkingBlock";
import { ActivityStatusIcon, CategoryIcon, FileTypeIcon } from "./ActivityIcons";
import { ToolOutput } from "./ToolOutput";
import { TranscriptRowContext, type TranscriptRowContextValue } from "./TranscriptRow";

type ToolCall = Extract<SessionUpdate, { kind: "tool_call" }>;
type FileEdit = Extract<SessionUpdate, { kind: "file_edit" }>;

/**
 * One 24px step line. `px-2` is the band's inner breathing room: the hover fill
 * and the `inset-0` hit area span the whole row, while icon, text, chips and
 * chevron keep an 8px gutter from its edge. Bodies below a step indent with the
 * same 8px so output and thinking align with the step's content, not the band.
 */
const STEP = "flex min-w-0 items-center gap-1.5 px-2 py-1 text-[13px] leading-5";
/**
 * The hit area of an interactive step is the whole 24px line: an invisible
 * button covers it (keeping real button semantics and a focus ring) while the
 * content above stays selectable text and the chips above it stay clickable.
 * The overlay sits first, so positioned chips at `z-10` win the hit test.
 */
const STEP_TOGGLE =
  "absolute inset-0 cursor-pointer rounded focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";
const STEP_CHIP = "relative z-10";
const CHEVRON =
  "size-3.5 shrink-0 text-muted-foreground opacity-60 transition-transform group-hover:opacity-100";

function useTranscriptContext(): TranscriptRowContextValue {
  const shared = useContext(TranscriptRowContext);
  if (!shared) throw new Error("Activity step rendered outside its context");
  return shared;
}

/** One step line, clickable end-to-end only when there is a body to reveal. */
function StepRow({
  children,
  expandable,
  open,
  label,
  onToggle,
  tone,
}: {
  children: ReactNode;
  expandable: boolean;
  open: boolean;
  label: string;
  onToggle: () => void;
  tone?: string;
}) {
  if (!expandable) {
    return <div className={cn(STEP, tone)}>{children}</div>;
  }
  return (
    <div
      className={cn(STEP, tone, "group relative cursor-pointer rounded hover:bg-accent/40")}
      onClick={onToggle}
    >
      <button type="button" aria-expanded={open} aria-label={label} className={STEP_TOGGLE} />
      {children}
    </div>
  );
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
      <span className={cn(className, STEP_CHIP)} title={title}>
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
      className={cn(
        className,
        STEP_CHIP,
        "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
      )}
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
      <span className={cn(className, STEP_CHIP)} aria-label={label}>
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
      className={cn(className, STEP_CHIP, "hover:bg-accent/40")}
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
      <StepRow
        expandable={hasContent}
        open={open}
        label={open ? `Hide output for ${label}` : `Show output for ${label}`}
        onToggle={() => setOpen((value) => !value)}
        tone={awaiting ? "text-warn" : undefined}
      >
        {!bare && <CategoryIcon category={category} />}
        <span className="min-w-0 flex-1 truncate text-foreground/80" title={label}>
          {label}
        </span>
        {chipped && target ? <PathChip raw={target} /> : null}
        <ActivityStatusIcon status={update.status} />
        {hasContent ? (
          <ChevronRight className={cn(CHEVRON, open && "rotate-90")} strokeWidth={1.75} />
        ) : null}
      </StepRow>
      {awaiting && permission ? (
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-1">
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
      {open && update.content ? <ToolOutput content={update.content} /> : null}
    </div>
  );
}

function FileEditStep({ update, bare }: { update: FileEdit; bare: boolean }) {
  const shared = useTranscriptContext();
  const hasCounts = update.additions !== undefined || update.deletions !== undefined;
  return (
    <div className={STEP}>
      {!bare && <CategoryIcon category="edit" />}
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

function ThoughtStep({
  text,
  streaming,
  bare,
}: {
  text: string;
  streaming: boolean;
  bare: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shared = useTranscriptContext();
  const firstLine =
    text
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? "Thinking";
  return (
    <div className="flex min-w-0 flex-col">
      <StepRow
        expandable
        open={open}
        label={open ? "Hide thinking" : "Show thinking"}
        onToggle={() => setOpen((value) => !value)}
      >
        {!bare && <CategoryIcon category="think" />}
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{firstLine}</span>
        <ChevronRight className={cn(CHEVRON, open && "rotate-90")} strokeWidth={1.75} />
      </StepRow>
      {open ? (
        <div className="min-w-0 px-2 py-1">
          <ThinkingBlock
            embedded
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

export const ActivityGroupRow = memo(
  function ActivityGroupRow({
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
        return <ThoughtStep text={update.text} streaming={live} bare={bare} />;
      case "file_edit":
        return <FileEditStep update={update} bare={bare} />;
      case "tool_call":
        return <ToolCallStep update={update} bare={bare} category={item.category} />;
      default:
        return null;
    }
  },
  /**
   * A streamed chunk rebuilds every `ActivityItem` wrapper, so a shallow
   * compare re-renders every step in a long live group on each token. The
   * coalesced `update` object is only replaced for the row that changed, so
   * identity is the right equality: unchanged steps bail out of the commit.
   */
  (previous, next) =>
    previous.bare === next.bare &&
    previous.live === next.live &&
    previous.item.key === next.item.key &&
    previous.item.category === next.item.category &&
    previous.item.entry.update === next.item.entry.update,
);
