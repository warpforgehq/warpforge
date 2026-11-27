import { useState } from "react";

import type { ConfigPath } from "@/lib/projectConfig/ops";
import { isLocalPath } from "@/lib/projectConfig/view";
import { cn } from "@/lib/utils";
import type { EffectiveProjectConfig, ProjectConfigScope } from "@/protocol";
import { settingsControl } from "@/views/settings/primitives";

import type { ConfigEdit } from "./useProjectConfig";

/**
 * Edits that put `value` at `path` in `target`. A shared value under a local
 * override would stay hidden, so saving to Shared also drops the override.
 * @param view the merged config
 * @param path the field
 * @param value the new value
 * @param target the file to write
 * @returns the edits
 */
export function setEdits(
  view: EffectiveProjectConfig,
  path: ConfigPath,
  value: unknown,
  target: ProjectConfigScope,
): ConfigEdit[] {
  const edits: ConfigEdit[] = [{ path, scope: target, value }];
  if (target === "shared" && isLocalPath(view.localFields, path)) {
    edits.push({ path, remove: true, scope: "local" });
  }
  return edits;
}

/**
 * Edits that remove `path` from both files.
 * @param path the field or entry
 * @returns the edits
 */
export function clearEdits(path: ConfigPath): ConfigEdit[] {
  return [
    { path, remove: true, scope: "shared" },
    { path, remove: true, scope: "local" },
  ];
}

const SCOPE_OPTIONS = [
  { label: "Shared", value: "shared" },
  { label: "Only me", value: "local" },
] as const;

/**
 * Where an edit is saved: the committed file or this machine's overlay.
 * @param label accessible name
 * @param value the current target
 * @param disabled grey it out
 * @param onChange called with the picked target
 */
export function ScopeToggle({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: ProjectConfigScope;
  disabled?: boolean;
  onChange: (scope: ProjectConfigScope) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex h-6 shrink-0 items-center rounded-control border border-border p-px"
    >
      {SCOPE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={disabled}
          onClick={() => option.value !== value && onChange(option.value)}
          className={cn(
            "h-full rounded-[calc(var(--radius-control)-0.125rem)] px-1.5 text-[0.6875rem] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            option.value !== value
              ? "text-muted-foreground hover:text-foreground"
              : option.value === "local"
                ? LOCAL_TINT
                : "bg-foreground/10 text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Tint for anything that marks this machine's overlay. */
const LOCAL_TINT = "bg-info/15 text-info";

/**
 * The left edge of a row: an accent bar when its value comes from the overlay.
 * @param local the value comes from the overlay
 * @returns classes for the row
 */
export function localEdge(local: boolean): string {
  return cn("border-l-2", local ? "border-info" : "border-transparent");
}

/** The marker on collapsed rows whose values come from this machine's overlay. */
export function OnlyMeBadge() {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded px-1.5 text-[0.6875rem] font-medium leading-[1.125rem]",
        LOCAL_TINT,
      )}
    >
      Only me
    </span>
  );
}

/**
 * A text input that commits on blur or Enter, so a half-typed value is never saved.
 * @param label accessible name
 * @param value the saved value
 * @param placeholder hint text
 * @param disabled read-only
 * @param mono monospace text, for commands and patterns
 * @param className extra classes
 * @param onCommit called with the trimmed text when it differs from `value`
 */
export function DraftInput({
  label,
  value,
  placeholder,
  disabled,
  mono,
  className,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  className?: string;
  onCommit: (text: string) => void;
}) {
  return (
    <input
      key={value}
      aria-label={label}
      defaultValue={value}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      className={cn(settingsControl, "w-full", mono && "font-mono text-[0.75rem]", className)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      onBlur={(event) => {
        const text = event.currentTarget.value.trim();
        if (text !== value) onCommit(text);
      }}
    />
  );
}

/**
 * The save target of one field: where its value comes from until the user
 * picks otherwise. Picking Shared for a value held in Only me moves it.
 * @param view the merged config
 * @param path the field
 * @param fallback the target for a field neither file sets locally
 * @param current the field's current value, moved on a switch to Shared
 * @param edit applies edits to the form
 * @returns the source scope, the target and its setter
 */
export function useFieldScope(
  view: EffectiveProjectConfig,
  path: ConfigPath,
  fallback: ProjectConfigScope,
  current: unknown,
  edit: (edits: ConfigEdit[]) => void,
) {
  const source: ProjectConfigScope | null = isLocalPath(view.localFields, path) ? "local" : null;
  const [picked, setPicked] = useState<ProjectConfigScope | null>(null);
  const target = source ?? picked ?? fallback;
  const pick = (scope: ProjectConfigScope) => {
    setPicked(scope);
    if (scope === "shared" && source === "local" && current !== undefined) {
      edit(setEdits(view, path, current, "shared"));
    }
  };
  return { local: source === "local", pick, target };
}

/**
 * One labelled field with its save target.
 * @param label the field name
 * @param hint muted help under the label
 * @param scope the target and setter from `useFieldScope`
 * @param readOnly hide the toggle's interaction
 * @param children the control
 */
export function FieldRow({
  label,
  hint,
  scope,
  readOnly,
  children,
}: {
  label: string;
  hint?: string;
  scope: {
    local: boolean;
    target: ProjectConfigScope;
    pick: (scope: ProjectConfigScope) => void;
  };
  readOnly?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5 pl-2",
        localEdge(scope.local),
      )}
    >
      <div className="w-32 shrink-0">
        <div className="text-[0.75rem] font-medium text-foreground">{label}</div>
        {hint && <div className="text-[0.6875rem] text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex min-w-[12rem] flex-1 items-center gap-2">{children}</div>
      <ScopeToggle
        label={`Save ${label} to`}
        value={scope.target}
        disabled={readOnly}
        onChange={scope.pick}
      />
    </div>
  );
}

/**
 * A text or number field bound to one config path. Clearing it removes the key.
 * @param view the merged config
 * @param edit applies edits to the form
 * @param readOnly the file does not parse
 * @param path the field
 * @param label the field name
 * @param value its current value
 * @param numeric store the text as a whole number
 * @param fallback save target when neither file sets it locally; Shared by default
 * @param placeholder hint text
 * @param hint muted help under the label
 * @param mono monospace input
 */
export function TextField({
  view,
  edit,
  readOnly,
  path,
  label,
  value,
  numeric,
  fallback = "shared",
  placeholder,
  hint,
  mono,
}: {
  view: EffectiveProjectConfig;
  edit: (edits: ConfigEdit[]) => void;
  readOnly: boolean;
  path: ConfigPath;
  label: string;
  value: string | number | null;
  numeric?: boolean;
  fallback?: ProjectConfigScope;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
}) {
  const scope = useFieldScope(view, path, fallback, value ?? undefined, edit);
  const commit = (text: string) => {
    if (!text) return edit(clearEdits(path));
    const next = numeric ? Number(text) : text;
    if (numeric && !Number.isInteger(next)) return;
    edit(setEdits(view, path, next, scope.target));
  };
  return (
    <FieldRow label={label} hint={hint} scope={scope} readOnly={readOnly}>
      <DraftInput
        label={label}
        value={value === null ? "" : String(value)}
        placeholder={placeholder}
        disabled={readOnly}
        mono={mono}
        onCommit={commit}
      />
    </FieldRow>
  );
}
