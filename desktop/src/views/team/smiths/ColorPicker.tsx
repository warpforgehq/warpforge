import { smithColor } from "@/lib/smithColors";
import { CHART_COLORS } from "@/lib/themes";
import { cn } from "@/lib/utils";

/** The theme's palette as swatches; the value is a palette index. */
export function ColorPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (index: number) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex gap-2.5">
      {Array.from({ length: CHART_COLORS }, (_, index) => (
        <button
          key={index}
          type="button"
          role="radio"
          aria-checked={index === value}
          aria-label={`Colour ${index + 1}`}
          onClick={() => onChange(index)}
          className={cn(
            "size-6 rounded-full ring-offset-2 ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            index === value ? "ring-2 ring-foreground" : "hover:ring-1 hover:ring-border",
          )}
          style={{ backgroundColor: smithColor(index) }}
        />
      ))}
    </div>
  );
}
