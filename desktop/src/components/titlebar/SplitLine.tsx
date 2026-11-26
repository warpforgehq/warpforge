import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useTitleRow } from "@/store/titleRow";

/**
 * The split between the conversation and the side pane, drawn once from the
 * top of the title row to the bottom of the card, so no border cuts it. The
 * separator below stays the grab area; this only paints.
 */
export function SplitLine() {
  const splitX = useTitleRow((state) => state.splitX);
  const hot = useTitleRow((state) => state.splitHot);
  const ref = useRef<HTMLSpanElement>(null);
  const [originX, setOriginX] = useState<number | null>(null);

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => setOriginX(parent.getBoundingClientRect().left);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const visible = splitX !== null && originX !== null;
  return (
    <span
      ref={ref}
      aria-hidden
      data-split-line
      style={visible ? { left: splitX - originX } : undefined}
      className={cn(
        "pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-edge",
        "before:absolute before:inset-y-0 before:-inset-x-px before:bg-[linear-gradient(to_right,transparent,hsl(var(--primary)/1),transparent)] before:opacity-0 before:blur-[1px] before:transition-opacity before:duration-200",
        hot && "before:opacity-100",
        !visible && "hidden",
      )}
    />
  );
}
