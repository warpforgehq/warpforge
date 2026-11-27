import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Class for native `<select>` and text `<input>` controls on settings rows. */
export const settingsControl =
  "h-7 min-w-0 max-w-full rounded-md border border-border/60 bg-background px-2 text-[0.8125rem] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 hover:border-border focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Wrap an HSL triplet token in `hsl()`.
 * @param triplet Space-separated HSL components, e.g. `"220 14% 10%"`.
 * @returns A CSS colour string.
 */
export function hsl(triplet: string): string {
  return `hsl(${triplet})`;
}

/**
 * A small stepper for integer values.
 * @param value Current value.
 * @param min Lowest allowed value.
 * @param max Highest allowed value.
 * @param onChange Called with the clamped next value.
 */
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
    <div className="flex h-7 items-center rounded-md border border-border/60 bg-background">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label="Decrease"
        className="h-full w-7 rounded-r-none p-0 text-[0.8125rem]"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      >
        −
      </Button>
      <span className="w-9 text-center text-[0.8125rem] tabular-nums">{value}</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label="Increase"
        className="h-full w-7 rounded-l-none p-0 text-[0.8125rem]"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      >
        +
      </Button>
    </div>
  );
}

/**
 * A range control with its current value read out beside it.
 * @param id DOM id of the range input.
 * @param value Current value.
 * @param min Lowest value.
 * @param max Highest value.
 * @param step Increment, 1 when omitted.
 * @param display Read-out text shown beside the track.
 * @param disabled Grey the control out.
 * @param onChange Called with the new value.
 */
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
      <span className="w-10 text-right text-[0.75rem] tabular-nums text-muted-foreground">
        {display}
      </span>
    </div>
  );
}

/**
 * The settings switch.
 * @param id DOM id of the underlying checkbox.
 * @param label Accessible name.
 * @param checked Whether the switch is on.
 * @param disabled Grey the switch out.
 * @param onChange Called with the next checked state.
 */
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
      className={`relative inline-flex shrink-0 items-center ${
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

/**
 * A row of mutually exclusive options, for two- or three-way choices.
 * @param label Accessible name of the radio group.
 * @param value The selected option's value.
 * @param options Values and their visible labels, in display order.
 * @param disabled Grey the whole group out.
 * @param onChange Called with the picked value; not called for the current one.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className="inline-flex h-7 shrink-0 items-center rounded-md border border-border/60 bg-background p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange(option.value)}
            className={cn(
              "h-full cursor-pointer rounded-[0.3rem] px-2.5 text-[0.75rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              active
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
