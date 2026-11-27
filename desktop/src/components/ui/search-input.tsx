import { Search } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The app's search field: a pill with a leading magnifier.
 * @param className Classes for the wrapper, e.g. width or flex sizing.
 * @param inputClassName Classes for the input itself.
 */
const SearchInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input"> & { inputClassName?: string }
>(({ className, inputClassName, type = "search", ...props }, ref) => (
  <div className={cn("relative min-w-0", className)}>
    <Search
      aria-hidden
      className="pointer-events-none absolute bottom-0 left-3 top-0 my-auto size-3.5 text-muted-foreground"
    />
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-8 w-full rounded-full border border-border bg-foreground/[0.03] pl-8 pr-3 text-[0.8125rem] text-foreground outline-none transition-colors placeholder:text-muted-foreground/80 hover:border-edge focus-visible:border-edge focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-search-cancel-button]:hidden",
        inputClassName,
      )}
      {...props}
    />
  </div>
));
SearchInput.displayName = "SearchInput";

export { SearchInput };
