import { Info } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Shared building blocks for the Settings pages. */

export const settingsSelect =
  "min-h-7 max-w-full rounded-md border bg-background px-2 text-[0.8125rem] outline-none focus:ring-1 focus:ring-ring disabled:opacity-50";

export function hsl(triplet: string): string {
  return `hsl(${triplet})`;
}

/**
 * A titled group of settings, on a card.
 *
 * Every section on every page is this card — one surface, one border, and the
 * rows inside are separated by dividers rather than each carrying a box of its
 * own. Content that is a form or a grid of toggles rather than a list of rows
 * passes `padded`.
 */
export function Section({
  id,
  title,
  padded,
  children,
}: {
  id?: string;
  title: string;
  padded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} tabIndex={id ? -1 : undefined} className="space-y-2 rounded-xl">
      <h2 className="px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-foreground/50">
        <span className="mr-2 inline-block h-px w-3 bg-rule" aria-hidden />
        {title}
      </h2>
      <div className="overflow-hidden rounded-xl border border-border bg-foreground/[0.02]">
        {padded ? <div className="p-4">{children}</div> : children}
      </div>
    </section>
  );
}

/**
 * One changeable setting: what it is on the left, the control on the right.
 *
 * `description` is a single line — the shortest sentence that says what the
 * control does. Everything longer (install steps, where the file lives, what
 * the daemon does about it) belongs in `hint`, behind the info icon, because a
 * three-line paragraph per row turns a settings list into a document nobody
 * scans. The control column has a floor width so every control on a page
 * shares one right edge instead of ragging by label length.
 */
export function SettingRow({
  id,
  title,
  description,
  hint,
  control,
  resetAction,
}: {
  id?: string;
  title: string;
  description: string;
  hint?: string;
  control: React.ReactNode;
  resetAction?: React.ReactNode;
}) {
  return (
    <div
      id={id}
      tabIndex={id ? -1 : undefined}
      className="flex min-h-7 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-rule px-3 py-0.5 first:border-t-0"
    >
      <div className="flex min-w-36 flex-1 flex-wrap items-baseline gap-x-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="min-w-0 break-words text-[0.8125rem] font-semibold text-foreground">
            {title}
          </h3>
          {resetAction}
        </div>
        {(description || hint) && (
          <p className="min-w-0 break-words text-[0.75rem] text-muted-foreground">
            {description}
            {hint && (
              <span
                role="img"
                aria-label={hint}
                title={hint}
                className="ml-1 inline-flex shrink-0 cursor-help align-text-bottom text-muted-foreground/60"
              >
                <Info className="size-3" aria-hidden />
              </span>
            )}
          </p>
        )}
      </div>
      <div className="ml-auto flex max-w-full items-center justify-end gap-2">{control}</div>
    </div>
  );
}

/**
 * Facts at the foot of a section: counts, detected state, values the daemon
 * owns and this screen cannot change.
 *
 * They used to be setting rows with a `<span>` where the control belongs,
 * which invites a click that does nothing. A strip states them as what they
 * are — readings, not switches.
 */
export function StatusStrip({
  items,
}: {
  items: { label: string; value: React.ReactNode; title?: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-rule px-4 py-2.5">
      {items.map((item) => (
        <span
          key={item.label}
          className="flex items-center gap-1.5 text-[0.6875rem]"
          title={item.title}
        >
          <span className="text-muted-foreground/70">{item.label}</span>
          <span className="tabular-nums text-foreground/80">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

/** A sentence at the foot of a section, tying its rows together. */
export function SectionNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-t border-rule px-4 py-2.5 text-[0.6875rem] text-muted-foreground/70">
      {children}
    </p>
  );
}

export function NumberInput({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 w-7 p-0 text-[0.8125rem]"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      >
        −
      </Button>
      <span className="w-10 text-center text-sm tabular-nums">{value}</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 w-7 p-0 text-[0.8125rem]"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      >
        +
      </Button>
    </div>
  );
}

/** A range control with its current value read out beside it. */
export function Slider({
  id,
  value,
  min,
  max,
  step,
  display,
  disabled,
  onChange,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-32 cursor-pointer appearance-none rounded-full bg-muted-foreground/30 accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className="w-10 text-right text-[0.6875rem] tabular-nums text-muted-foreground">
        {display}
      </span>
    </div>
  );
}

/** A toggle switch styled as a settings row control. */
export function Toggle({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={`relative inline-flex items-center ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-label={label}
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="h-5 w-9 rounded-full bg-muted-foreground/30 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-checked:bg-foreground/80 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-background after:transition-transform peer-checked:after:translate-x-4" />
    </label>
  );
}
