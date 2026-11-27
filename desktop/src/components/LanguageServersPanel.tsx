import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SettingsBadge, SettingsRow } from "@/views/settings/primitives";

import { daemon } from "../daemon";
import { SettingsListSkeleton } from "./SettingsListSkeleton";

export const LANGUAGE_SERVERS_QUERY_KEY = ["languageServers"];

/** Last meaningful line of command output, skipping npm's log-file boilerplate
 * so a failed install surfaces the actual error ("404 Not Found", etc.). */
function lastLine(output: string): string {
  const lines = (output ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/A complete log of this run/.test(l));
  return lines[lines.length - 1] ?? "install failed";
}

/**
 * Install/update panel for the language servers behind editor IntelliSense.
 * Detects every supported language's server and lets the user install or update
 * the missing/outdated ones — no manual command needed.
 */
export default function LanguageServersPanel() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Detection shells out to every server's `--version` and asks npm for newer
  // ones, so it takes seconds. It lives in the query cache rather than local
  // state: reopening Settings then shows the last known list immediately
  // instead of a spinner, and only re-checks once the result has gone stale.
  const {
    data: servers = [],
    isFetching,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: LANGUAGE_SERVERS_QUERY_KEY,
    queryFn: () => daemon.detectLanguageServers(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const manage = async (id: string) => {
    setBusy((prev) => new Set(prev).add(id));
    setErrors((prev) => {
      const { [id]: _cleared, ...rest } = prev;
      return rest;
    });
    try {
      const result = await daemon.installLanguageServer(id);
      if (!result.ok) {
        setErrors((prev) => ({
          ...prev,
          [id]: lastLine(result.output) || "install failed",
        }));
      }
      queryClient.setQueryData(LANGUAGE_SERVERS_QUERY_KEY, await daemon.detectLanguageServers());
    } catch (e) {
      setErrors((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  if (servers.length === 0 && isFetching) {
    return <SettingsListSkeleton rows={4} label="Loading language servers" />;
  }

  if (servers.length === 0 && loadError) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to detect language servers: {loadError.message}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="divide-y divide-border/60">
        {servers.map((server) => {
          const isBusy = busy.has(server.id);
          const behind = server.status === "behind";
          return (
            <SettingsRow
              key={server.id}
              title={server.language}
              meta={
                !server.installed ? (
                  <SettingsBadge>not found</SettingsBadge>
                ) : behind ? (
                  <SettingsBadge tone="warn">update available</SettingsBadge>
                ) : (
                  <span className="font-mono text-[0.75rem] text-muted-foreground">
                    {server.version ? `v${server.version}` : "installed"}
                  </span>
                )
              }
              description={
                (behind && server.latestVersion && server.version) ||
                (!server.installed && !server.canManage) ||
                errors[server.id] ? (
                  <>
                    {behind && server.latestVersion && server.version && (
                      <span className="block text-warn">
                        v{server.version} → v{server.latestVersion}
                      </span>
                    )}
                    {!server.installed && !server.canManage && (
                      <span className="block">
                        Install: <span className="font-mono">{server.installHint}</span>
                      </span>
                    )}
                    {errors[server.id] && (
                      <span className="block font-mono text-destructive">{errors[server.id]}</span>
                    )}
                  </>
                ) : undefined
              }
              control={
                server.canManage &&
                (!server.installed || behind) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => void manage(server.id)}
                  >
                    {isBusy && <Loader2 className="size-3 animate-spin" />}
                    {isBusy ? "Working…" : server.installed ? "Update" : "Install"}
                  </Button>
                )
              }
            />
          );
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-border/60 px-3.5 py-2.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RotateCw className={cn("size-3", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>
    </div>
  );
}
