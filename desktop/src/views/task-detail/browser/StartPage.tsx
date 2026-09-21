import { Globe, Server } from "lucide-react";

import type { ServiceInfo } from "../../../protocol";

interface Props {
  /** Running dev services of the project, offered as quick links. */
  services: ServiceInfo[];
  /** Open a service URL or a typed address/search. */
  onGo: (input: string) => void;
}

/** The new-tab landing: the project's running services as quick links. Typing
 *  goes through the address bar above; a work tool opens what you are building,
 *  not a search engine's ads. */
export function StartPage({ onGo, services }: Props) {
  const running = services.filter((s) => s.status === "running" || s.status === "starting");

  return (
    <div className="flex h-full min-h-0 flex-col items-center overflow-auto bg-background px-6 py-12">
      <div className="w-full max-w-md">
        {running.length > 0 ? (
          <>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Server className="size-3.5" />
              Running in this project
            </div>
            <div className="flex flex-col gap-1">
              {running.map((s) => {
                const url = `http://localhost:${s.allocatedPort}`;
                return (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => onGo(url)}
                    className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="min-w-0 truncate">{s.name}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{url}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Globe className="size-3.5" />
            Start a service in Runtime and it will show up here.
          </p>
        )}
      </div>
    </div>
  );
}
