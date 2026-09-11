import { ArrowLeftRight } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export interface FlipButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether the conversation currently sits to the right of the workspace. */
  chatOnRight: boolean;
}

export const FlipButton = React.forwardRef<HTMLButtonElement, FlipButtonProps>(
  ({ chatOnRight, className, ...props }, ref) => {
    const label = chatOnRight ? "Move conversation to the left" : "Move conversation to the right";
    return (
      <button
        ref={ref}
        {...props}
        type="button"
        aria-label={label}
        aria-pressed={chatOnRight}
        title={label}
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
      >
        <ArrowLeftRight aria-hidden className="size-3.5" />
      </button>
    );
  },
);
FlipButton.displayName = "FlipButton";
