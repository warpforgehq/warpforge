import * as SelectPrimitive from "@radix-ui/react-select";
import * as React from "react";

import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Chip trigger styled like the row's cell, opening the standard Select. */
export function FieldChip<T extends string>({
  ariaLabel,
  value,
  options,
  triggerClassName,
  onValueChange,
  children,
}: {
  ariaLabel: string;
  value: T;
  options: { value: T; label: string }[];
  triggerClassName?: string;
  onValueChange: (value: T) => void;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as T)}>
      <SelectPrimitive.Trigger
        type="button"
        aria-label={ariaLabel}
        className={cn(
          "flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[13px] transition-colors",
          "hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground",
          triggerClassName,
        )}
      >
        {children}
      </SelectPrimitive.Trigger>
      <SelectContent className="min-w-[10rem]" align="start" sideOffset={4}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
