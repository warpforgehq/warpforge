export function EnabledSwitch({
  checked,
  id,
  label,
  onChange,
}: {
  checked: boolean;
  id: string;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="relative inline-flex shrink-0 cursor-pointer items-center">
      <span className="sr-only">{label}</span>
      <input
        id={id}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        title={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div className="h-5 w-9 rounded-full bg-muted-foreground/30 transition-colors peer-checked:bg-primary/80 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-background after:transition-transform peer-checked:after:translate-x-4" />
    </label>
  );
}
