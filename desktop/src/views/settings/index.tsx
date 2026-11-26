import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { SettingsNav } from "@/components/Sidebar/SettingsNav";
import { Button } from "@/components/ui/button";
import type { Snapshot } from "@/protocol";
import { useUi, type SettingsPage } from "@/store/ui";
import MemoryBrowserView from "@/views/Memory";

import { SETTINGS_PAGES } from "./nav";
import AdvancedPage from "./pages/Advanced";
import AgentsPage from "./pages/Agents";
import AppearancePage from "./pages/Appearance";
import IntegrationsPage from "./pages/Integrations";
import MemoryPage from "./pages/Memory";
import ModelsPage from "./pages/Models";
import NotificationsPage from "./pages/Notifications";
import TasksPage from "./pages/Tasks";

const PAGES: Record<SettingsPage, () => React.ReactElement> = {
  appearance: AppearancePage,
  notifications: NotificationsPage,
  models: ModelsPage,
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
  const target = useUi((s) => s.settingsTarget);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) return;
    const row = document.getElementById(target.id);
    if (!row || !content.current?.contains(row)) return;
    row.setAttribute("data-highlighted", "");
    row.focus({ preventScroll: true });
    row.scrollIntoView?.({ block: "center" });
    return () => row.removeAttribute("data-highlighted");
  }, [page, target]);

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
    <div
      data-testid="settings-view"
      ref={content}
      className="flex min-h-0 min-w-0 flex-1 flex-col [&_[data-highlighted]]:bg-primary/10 [&_[data-highlighted]]:outline-none [&_[data-highlighted]]:ring-1 [&_[data-highlighted]]:ring-inset [&_[data-highlighted]]:ring-primary"
    >
      <header
        data-tauri-drag-region="deep"
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-2.5"
      >
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground"
        >
          <span className="text-[0.8125rem]">Settings</span>
          <span aria-hidden className="text-[0.8125rem] text-muted-foreground/60">
            /
          </span>
          <strong className="min-w-0 truncate text-[0.9375rem] font-medium text-foreground">
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
      {showNav && <SettingsNav inline />}
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
