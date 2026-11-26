import { Search } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";
import { SETTINGS_GROUPS, SETTINGS_PAGES } from "@/views/settings/nav";
import { searchSettings } from "@/views/settings/search";

import { SIDEBAR_BODY_ID } from "./modes";

const navButton =
  "flex min-h-7 items-center gap-2 rounded-md px-2.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

export function SettingsNav({ inline = false }: { inline?: boolean }) {
  const page = useUi((s) => s.settingsPage);
  const setPage = useUi((s) => s.setSettingsPage);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const results = searchSettings(query);

  return (
    <nav
      id={inline ? undefined : SIDEBAR_BODY_ID}
      aria-label="Settings sections"
      className={cn(
        "flex min-h-0 flex-col gap-2 px-2 py-2",
        inline ? "shrink-0 border-b border-rule" : "flex-1 overflow-y-auto",
      )}
    >
      <div className="relative shrink-0">
        <Search
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-2.5 top-0 my-auto size-3.5 text-muted-foreground"
        />
        <input
          type="search"
          aria-label="Search settings"
          placeholder="Search settings"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              setQuery("");
            }
            if (event.key === "Enter" && results[0]) {
              setPage(results[0].page, results[0].id);
              setQuery("");
            }
          }}
          className="min-h-7 w-full rounded-md border border-border bg-foreground/[0.02] pl-8 pr-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      {searching ? (
        <div className={cn("flex flex-col", inline && "max-h-48 overflow-y-auto")}>
          {results.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                setPage(row.page, row.id);
                setQuery("");
              }}
              className={cn(navButton, "justify-between hover:bg-accent/40")}
            >
              <span>{row.title}</span>
              <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                {SETTINGS_PAGES.find((item) => item.id === row.page)?.label}
              </span>
            </button>
          ))}
          {results.length === 0 && (
            <p className="px-2.5 py-1 text-xs text-muted-foreground">No settings found</p>
          )}
        </div>
      ) : (
        <div className={cn("flex gap-2", inline ? "overflow-x-auto" : "flex-col")}>
          {SETTINGS_GROUPS.map((group) => (
            <section
              key={group.label}
              aria-label={group.label}
              className={cn(
                "shrink-0",
                inline && "border-r border-rule pr-2 last:border-0 last:pr-0",
              )}
            >
              <h2 className="px-2.5 text-[0.6875rem] font-medium text-muted-foreground">
                {group.label}
              </h2>
              <div className={cn("flex gap-px", !inline && "flex-col")}>
                {group.pages.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    aria-current={id === page ? "page" : undefined}
                    onClick={() => setPage(id)}
                    className={cn(
                      navButton,
                      "relative whitespace-nowrap",
                      id === page
                        ? "bg-accent/60 font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                    )}
                  >
                    {id === page && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary"
                      />
                    )}
                    <Icon
                      className={cn("size-3.5 shrink-0", id === page && "text-primary")}
                      aria-hidden
                    />
                    {label}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </nav>
  );
}
