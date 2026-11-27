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
  if (onBack) {
    return (
      <div
        data-tauri-drag-region="deep"
        className="flex h-14 shrink-0 items-end gap-1 pb-1 pl-5 pr-3 pt-2"
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back from Settings"
          title="Back (Esc)"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ChevronLeft aria-hidden className="size-4" />
        </button>
        <h2 className="select-none pb-px text-[1.25rem] font-semibold tracking-tight text-foreground">
          {title}
        </h2>
      </div>
    );
  }

  return (
    <div
      data-tauri-drag-region="deep"
      className="flex h-10 shrink-0 items-center gap-1.5 pl-7 pr-3 pt-2"
    >
      <h2 className="select-none text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-foreground">
        {title}
      </h2>
      <span className="flex-1" />
      {count !== undefined && count > 0 && (
        <span className="font-mono text-[0.6875rem] tabular-nums text-warn">{count}</span>
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
