import { X } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Snapshot } from "@/protocol";
import { useUi, type SettingsPage } from "@/store/ui";
import MemoryBrowserView from "@/views/Memory";

import { SETTINGS_PAGES } from "./nav";
import AdvancedPage from "./pages/Advanced";
import AgentsPage from "./pages/Agents";
import AppearancePage from "./pages/Appearance";
import IntegrationsPage from "./pages/Integrations";
import MemoryPage from "./pages/Memory";
import TasksPage from "./pages/Tasks";

const PAGES: Record<SettingsPage, () => React.ReactElement> = {
  appearance: AppearancePage,
  agents: AgentsPage,
  integrations: IntegrationsPage,
  tasks: TasksPage,
  memory: MemoryPage,
  advanced: AdvancedPage,
};

interface Props {
  /** The sidebar panel is hidden, so the sections render here as tabs. */
  showNav: boolean;
  snapshot: Snapshot;
  onOpenTask: (id: string) => void;
  onClose: () => void;
}

/** A layer that owns Escape is open: a dialog, menu, popover or select. */
function escapeBelongsElsewhere(): boolean {
  return !!document.querySelector(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]',
  );
}

/**
 * Settings in the main area. The sidebar panel lists the sections beside it,
 * so there is no second navigation column here.
 */
export default function SettingsView({ showNav, snapshot, onOpenTask, onClose }: Props) {
  const page = useUi((s) => s.settingsPage);
  const setPage = useUi((s) => s.setSettingsPage);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || escapeBelongsElsewhere()) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const Page = PAGES[page] ?? AppearancePage;
  const label = SETTINGS_PAGES.find((item) => item.id === page)?.label ?? "Appearance";

  return (
    <div data-testid="settings-view" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header
        data-tauri-drag-region="deep"
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-2.5"
      >
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground"
        >
          <span className="text-[13px]">Settings</span>
          <span aria-hidden className="text-[13px] text-muted-foreground/60">
            /
          </span>
          <strong className="min-w-0 truncate text-[15px] font-medium text-foreground">
            {label}
          </strong>
        </nav>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onClose}
          aria-label="Close settings"
          title="Close settings (Esc)"
          type="button"
        >
          <X className="size-4" />
        </Button>
      </header>
      {showNav && (
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-rule px-2.5 py-1.5"
        >
          {SETTINGS_PAGES.map(({ id, label: itemLabel, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={id === page ? "page" : undefined}
              onClick={() => setPage(id)}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors",
                id === page
                  ? "bg-accent/60 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              {itemLabel}
            </button>
          ))}
        </nav>
      )}
      {page === "memory" ? (
        <main className="flex min-h-0 flex-1 flex-col px-5 pt-2">
          <MemoryBrowserView snapshot={snapshot} onOpenTask={onOpenTask} header={<Page />} />
        </main>
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 pb-10 pt-6">
            <Page />
          </div>
        </main>
      )}
    </div>
  );
}
