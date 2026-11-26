import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";
import { SETTINGS_PAGES } from "@/views/settings/nav";

import { SIDEBAR_BODY_ID } from "./modes";

/** The Settings sections, in the panel's place while Settings are open. */
export function SettingsNav() {
  const page = useUi((s) => s.settingsPage);
  const setPage = useUi((s) => s.setSettingsPage);
  return (
    <nav
      id={SIDEBAR_BODY_ID}
      aria-label="Settings sections"
      className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 py-2"
    >
      {SETTINGS_PAGES.map(({ id, label, icon: Icon }) => {
        const active = id === page;
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => setPage(id)}
            className={cn(
              "relative flex h-7 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[0.75rem] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
              active
                ? "bg-accent/60 font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            {active && (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary"
              />
            )}
            <Icon
              className={cn("size-3.5 shrink-0", active ? "text-primary" : "opacity-70")}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
