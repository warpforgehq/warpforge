import { ChevronLeft } from "lucide-react";

import { AgentUpdateBanner } from "@/components/AgentUpdateBanner";
import { UpdateBanner } from "@/components/UpdateBanner";

/** The panel's title row: what the rail picked, with its count in mono. */
export function PanelHeader({
  title,
  count,
  onBack,
}: {
  title: string;
  count?: number;
  /** Shown as a back control, for Settings. */
  onBack?: () => void;
}) {
  return (
    <div
      data-tauri-drag-region="deep"
      className="flex h-10 shrink-0 items-center gap-1.5 pl-7 pr-3 pt-2"
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back from Settings"
          title="Back (Esc)"
          className="-ml-1.5 flex h-6 items-center gap-1 rounded px-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ChevronLeft aria-hidden className="size-3.5 text-muted-foreground" />
          {title}
        </button>
      ) : (
        <h2 className="select-none text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-foreground">
          {title}
        </h2>
      )}
      <span className="flex-1" />
      {count !== undefined && count > 0 && (
        <span className="font-mono text-[0.6875rem] tabular-nums text-warn">{count}</span>
      )}
      {onBack && (
        <kbd className="rounded border border-rule px-1 font-mono text-[0.625rem] text-muted-foreground/70">
          esc
        </kbd>
      )}
    </div>
  );
}

/** The update banners; empty when there is nothing to install. */
export function PanelFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <footer className="flex shrink-0 flex-col gap-1.5 border-t border-rule px-2 py-2 empty:hidden">
      <UpdateBanner />
      <AgentUpdateBanner onOpenSettings={onOpenSettings} />
    </footer>
  );
}
