import { smithColor } from "@/lib/smithColors";
import { CHART_COLORS } from "@/lib/themes";
import { cn } from "@/lib/utils";

/** The theme's palette as swatches; the value is a palette index. */
export function ColorPicker({
  value,
  onChange,
  name,
}: {
  value: number;
  onChange: (index: number) => void;
  /** Shown as the initial inside each swatch. */
  name: string;
}) {
  const initial = Array.from(name)[0]?.toUpperCase() ?? "S";
  return (
    <div role="radiogroup" aria-label="Colour" className="flex gap-1.5">
      {Array.from({ length: CHART_COLORS }, (_, index) => (
        <button
          key={index}
          type="button"
          role="radio"
          aria-checked={index === value}
          aria-label={`Colour ${index + 1}`}
          onClick={() => onChange(index)}
          className={cn(
            "grid size-7 place-items-center rounded-full text-[11px] font-semibold ring-offset-2 ring-offset-background transition-shadow focus-visible:outline-none",
            index === value ? "ring-2 ring-ring" : "hover:ring-1 hover:ring-border",
          )}
          style={{ backgroundColor: smithColor(index, 0.18), color: smithColor(index) }}
        >
          {initial}
        </button>
      ))}
    </div>
  );
}
