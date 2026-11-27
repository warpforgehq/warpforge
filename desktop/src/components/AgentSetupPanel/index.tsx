import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { SettingsListSkeleton } from "@/components/SettingsListSkeleton";
import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import { DaemonRpcError } from "@/daemon/rpcError";
import { agentUpdatesQueryKey } from "@/hooks/useAgentUpdates";
import { configRole } from "@/lib/configRole";
import type { AgentConfig, DetectedAgent } from "@/protocol";

import { AgentRow, type BrokenInstall } from "./AgentRow";

interface Props {
  /** Pre-loaded agents (dialog path: pendingAgentSetup already resolved). */
  detected?: DetectedAgent[];
  /** Fired after a successful save — the onboarding dialog uses it to close. */
  onSaved?: () => void;
  /** Let configured rows expand to their model lists (Settings only). */
  modelLists?: boolean;
}

/** How an ACP agent reports that it needs a login before it can start. */
const SIGNED_OUT = /authentication required/i;

/** Last non-empty line of command output, for a compact error hint. */
function lastLine(output: string): string {
  const lines = output.trim().split("\n");
  return lines[lines.length - 1]?.trim() ?? "";
}

/**
 * Already-configured agents render instantly as rows; detection only adds
 * version/update badges on top. Detection shells out to the npm registry and
 * takes seconds, so it must never gate the list.
 */
function fromConfig(agent: AgentConfig): DetectedAgent {
  return {
    canManage: false,
    canReinstall: false,
    defaultAcpCommand: agent.acpCommand,
    displayName: agent.displayName,
    id: agent.id,
    installHint: "",
    installed: true,
    status: "unknown",
  };
}

export default function AgentSetupPanel({ detected, onSaved, modelLists }: Props) {
  const state = useSyncExternalStore(daemon.subscribe, daemon.getState);
  const configured = state.snapshot.agents;
  const health = state.agentHealth ?? {};
  const queryClient = useQueryClient();
  // The app-wide agent poll already detects on connect; seeding from its cache
  // means Settings renders rows immediately instead of its detecting skeleton.
  const cachedAgents = () => queryClient.getQueryData<DetectedAgent[]>(agentUpdatesQueryKey);

  const [agents, setAgents] = useState<DetectedAgent[]>(
    () => detected ?? cachedAgents() ?? (configured ?? []).map(fromConfig),
  );
  const [enabled, setEnabled] = useState<Set<string>>(
    () =>
      new Set(
        configured?.length
          ? configured.reduce<string[]>((acc, a) => {
              if (a.enabled) acc.push(a.id);
              return acc;
            }, [])
          : (detected ?? []).reduce<string[]>((acc, a) => {
              if (a.installed) acc.push(a.id);
              return acc;
            }, []),
      ),
  );
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [probing, setProbing] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Agent id → why it cannot start. Kept apart from `errors` so only a real
  // broken install offers a Reinstall.
  const [broken, setBroken] = useState<Record<string, BrokenInstall>>({});
  // A verify failure that is not a broken install — shown as a neutral note.
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(() => !detected && cachedAgents() === undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Detection must not stomp on toggles the user has already made.
  const touched = useRef(false);

  useEffect(() => {
    if (detected) return;
    // The app-wide poll's cache is this same detection; re-running it on every
    // Settings open is the redundant shell-out the seed above avoids.
    if (queryClient.getQueryData(agentUpdatesQueryKey) !== undefined) return;
    let cancelled = false;
    setRefreshing(true);
    daemon
      .detectAgents()
      .then((list) => {
        if (cancelled) return;
        setAgents(list);
        if (!touched.current && !configured?.length) {
          setEnabled(
            new Set(
              list.reduce<string[]>((acc, a) => {
                if (a.installed) acc.push(a.id);
                return acc;
              }, []),
            ),
          );
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
    // Detection runs once per mount; `configured` is only read for the seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected]);

  // A live health change supersedes what this panel recorded from its own
  // install or reload.
  useEffect(
    () =>
      daemon.subscribeEvents((ev) => {
        if (ev.event !== "agents.healthUpdated") return;
        const { id } = ev.data;
        setBroken(({ [id]: _superseded, ...rest }) => rest);
      }),
    [],
  );

  const toggle = (id: string) => {
    // The selection no longer matches what was written — offer the save again.
    touched.current = true;
    setSaved(false);
    setSaveError(null);
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /** Drop an agent's transient errors, broken state and notes. */
  const clearAgentState = (id: string) => {
    const without = <T,>(prev: Record<string, T>): Record<string, T> => {
      const { [id]: _cleared, ...rest } = prev;
      return rest;
    };
    setErrors(without);
    setBroken(without);
    setNotes(without);
  };

  const manage = async (id: string, clean = false) => {
    setBusy((prev) => new Set(prev).add(id));
    clearAgentState(id);
    try {
      const result = await daemon.installAgent(id, clean);
      if (!result.ok) {
        setErrors((prev) => ({ ...prev, [id]: lastLine(result.output) || "install failed" }));
      } else if (!result.verified && result.verifyError) {
        // Only a broken-install signature means the install is broken; any
        // other failure (a login prompt, say) is a note, not a reinstall.
        if (result.brokenInstall) {
          setBroken((prev) => ({
            ...prev,
            [id]: {
              summary: result.summary ?? result.verifyError!,
              full: result.verifyError!,
              canReinstall: agents.find((a) => a.id === id)?.canReinstall ?? false,
            },
          }));
        } else {
          setNotes((prev) => ({ ...prev, [id]: result.verifyError! }));
        }
      }
      const refreshed = await daemon.detectAgents();
      setAgents(refreshed);
      // The app-wide badge reads the shared query, not this local list.
      void queryClient.invalidateQueries({ queryKey: agentUpdatesQueryKey });
      if (result.ok) {
        const nowInstalled = refreshed.find((a) => a.id === id)?.installed;
        if (nowInstalled) setEnabled((prev) => new Set(prev).add(id));
      }
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

  /**
   * Re-read model lists from the harnesses themselves. Needed when a provider
   * or model was added outside Warpforge — the daemon caches the lists and only
   * refreshes them on its own at startup.
   *
   * Every enabled agent is probed at once, and each one owns its failure: a
   * harness that never answers records its error on its own row and leaves the
   * others' fresh lists alone.
   */
  const refreshModels = async (ids: string[]) => {
    if (ids.length === 0) return;
    setProbing((prev) => new Set([...prev, ...ids]));
    for (const id of ids) clearAgentState(id);
    await Promise.all(
      ids.map(async (id) => {
        try {
          await daemon.probeAgent(id);
        } catch (e) {
          if (e instanceof DaemonRpcError && e.code === "agent_broken_install") {
            setBroken((prev) => ({
              ...prev,
              [id]: {
                summary: e.detail,
                full: e.detail,
                canReinstall: agents.find((a) => a.id === id)?.canReinstall ?? false,
              },
            }));
          } else {
            setErrors((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : String(e) }));
          }
        }
      }),
    );
    setProbing((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  };

  const save = async () => {
    // Write every known agent, not just the enabled ones: dropping the rest
    // would erase the record that the user deliberately turned them off. Cached
    // models and the last picked model belong to the stored config, so carry
    // them over rather than resetting the agent on every save.
    const configs: AgentConfig[] = agents.map((a) => {
      const existing = configured?.find((c) => c.id === a.id);
      return {
        acpCommand: existing?.acpCommand ?? a.defaultAcpCommand,
        displayName: a.displayName,
        enabled: enabled.has(a.id),
        id: a.id,
        lastModel: existing?.lastModel,
        models: existing?.models ?? [],
      };
    });
    setSaveError(null);
    try {
      await daemon.saveAgents(configs);
      void queryClient.invalidateQueries({ queryKey: agentUpdatesQueryKey });
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  if (agents.length === 0 && refreshing) {
    return <SettingsListSkeleton rows={4} label="Loading agents" />;
  }

  if (agents.length === 0 && loadError) {
    return <div className="p-4 text-sm text-destructive">Failed to detect agents: {loadError}</div>;
  }

  // Only a saved-enabled agent has a cached list the daemon can re-read.
  const refreshableIds = agents
    .filter((a) => configured?.find((c) => c.id === a.id)?.enabled)
    .map((a) => a.id);

  return (
    <>
      <div className="divide-y divide-rule">
        {agents.map((agent) => {
          const savedConfig = configured?.find((c) => c.id === agent.id);
          // A result recorded in this panel wins over the daemon's mark; an
          // agent this detection reports uninstalled carries no stale mark.
          const mark = agent.id in health ? health[agent.id] : agent.brokenInstall;
          const healthBroken: BrokenInstall | undefined =
            agent.installed && mark
              ? {
                  summary: mark.summary,
                  full: mark.detail,
                  canReinstall: agent.canReinstall ?? false,
                }
              : undefined;
          const brokenInfo = broken[agent.id] ?? healthBroken;
          return (
            <AgentRow
              key={agent.id}
              agent={agent}
              enabled={enabled.has(agent.id)}
              busy={busy.has(agent.id)}
              probing={probing.has(agent.id)}
              modelCount={
                savedConfig?.models.find((o) => configRole(o) === "model")?.options.length
              }
              broken={brokenInfo}
              signedOut={
                agent.id === "antigravity" &&
                SIGNED_OUT.test(`${brokenInfo?.full ?? ""} ${notes[agent.id] ?? ""}`)
              }
              error={errors[agent.id]}
              note={notes[agent.id]}
              models={modelLists ? savedConfig : undefined}
              onToggle={() => toggle(agent.id)}
              onManage={(clean) => void manage(agent.id, clean)}
              onSignedIn={(error) => {
                clearAgentState(agent.id);
                setNotes((prev) => ({ ...prev, [agent.id]: error ?? "Signed in with Google." }));
              }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-rule px-3.5 py-2.5">
        <span className="mr-auto text-[0.75rem] text-muted-foreground">
          Enable the agents you want available for new tasks, then Save.
        </span>
        {refreshing && (
          <span className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Checking versions…
          </span>
        )}
        {loadError && !refreshing && (
          <span className="text-[0.75rem] text-muted-foreground">
            Version check failed: {loadError}
          </span>
        )}
        {saveError && <span className="text-[0.75rem] text-destructive">{saveError}</span>}
        {/* One button for the whole list. Per-agent buttons repeated the same
            label down the column for no gain: you reload because something
            changed outside Warpforge, and you rarely know which harness saw it. */}
        {refreshableIds.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={probing.size > 0}
            onClick={() => void refreshModels(refreshableIds)}
          >
            {probing.size > 0 ? "Reloading…" : "Reload models list"}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => void save()} disabled={saved}>
          {saved ? "Saved" : "Save"}
        </Button>
      </div>
    </>
  );
}
