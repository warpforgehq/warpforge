import { Eye, EyeOff, Loader2 } from "lucide-react";

import { AgentLogo } from "@/components/AgentLogo";
import { AgentSignIn } from "@/components/AgentSignIn";
import { Button } from "@/components/ui/button";
import type { DetectedAgent } from "@/protocol";
import { SettingsBadge, SettingsRow, Toggle } from "@/views/settings/primitives";

/** An installed agent that cannot start. `summary` is the one-line reason,
 *  `full` the untruncated text for a tooltip. */
export interface BrokenInstall {
  summary: string;
  full: string;
  canReinstall: boolean;
}

interface Props {
  agent: DetectedAgent;
  enabled: boolean;
  busy: boolean;
  probing: boolean;
  modelCount?: number;
  broken?: BrokenInstall;
  signedOut: boolean;
  error?: string;
  note?: string;
  /** Present when the row also controls whether pickers list the agent. */
  picker?: { shown: boolean; onChange: (shown: boolean) => void };
  onToggle: () => void;
  onManage: (clean: boolean) => void;
  onSignedIn: (error: string | null) => void;
}

/**
 * One agent in the setup list: identity and state on the left, actions and
 * the enabled switch on the right.
 */
export function AgentRow({
  agent,
  enabled,
  busy,
  probing,
  modelCount,
  broken,
  signedOut,
  error,
  note,
  picker,
  onToggle,
  onManage,
  onSignedIn,
}: Props) {
  const behind = agent.status === "behind";
  const isBroken = broken !== undefined && !signedOut;

  const meta = !agent.installed ? (
    <SettingsBadge>not found</SettingsBadge>
  ) : signedOut ? (
    <SettingsBadge tone="warn">signed out</SettingsBadge>
  ) : isBroken ? (
    <SettingsBadge tone="warn">
      {broken.canReinstall ? "needs reinstall" : "cannot start"}
    </SettingsBadge>
  ) : behind ? (
    <SettingsBadge tone="warn">update available</SettingsBadge>
  ) : (
    <span className="font-mono text-[0.75rem] text-muted-foreground">
      {agent.version ? `v${agent.version}` : "installed"}
    </span>
  );

  const description = (
    <>
      <span className="font-mono">{agent.defaultAcpCommand}</span>
      {probing ? " · reloading models…" : modelCount !== undefined && ` · ${modelCount} models`}
      {behind && agent.latestVersion && (
        <span className="block text-warn">
          v{agent.version} → v{agent.latestVersion}
        </span>
      )}
      {!agent.installed && !agent.canManage && (
        <span className="block">
          Install: <span className="font-mono">{agent.installHint}</span>
        </span>
      )}
      {error && <span className="block font-mono text-destructive">{error}</span>}
      {signedOut && (
        <span className="block text-warn" title={broken?.full}>
          Sign in before starting a task with this agent.
        </span>
      )}
      {broken && !signedOut && (
        <span className="block text-warn" title={broken.full}>
          {broken.summary}
        </span>
      )}
      {note && !signedOut && <span className="block">{note}</span>}
    </>
  );

  const busyLabel = (
    <>
      <Loader2 className="size-3 animate-spin" />
      Working…
    </>
  );

  return (
    <SettingsRow
      icon={<AgentLogo agentId={agent.id} displayName={agent.displayName} />}
      title={agent.displayName}
      meta={meta}
      description={description}
      control={
        <>
          {agent.installed && signedOut && (
            <AgentSignIn agentId={agent.id} displayName={agent.displayName} onDone={onSignedIn} />
          )}
          {isBroken && broken.canReinstall && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onManage(true)}>
              {busy ? busyLabel : "Reinstall"}
            </Button>
          )}
          {agent.canManage && !isBroken && (!agent.installed || behind) && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onManage(false)}>
              {busy ? busyLabel : agent.installed ? "Update" : "Install"}
            </Button>
          )}
          {picker && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="w-7 p-0 text-muted-foreground"
              aria-pressed={picker.shown}
              aria-label={`Show ${agent.displayName} in agent pickers`}
              title={picker.shown ? "Shown in agent pickers" : "Hidden from agent pickers"}
              onClick={() => picker.onChange(!picker.shown)}
            >
              {picker.shown ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            </Button>
          )}
          <Toggle
            id={`agent-enabled-${agent.id}`}
            label={`Enable ${agent.displayName}`}
            checked={enabled}
            onChange={onToggle}
          />
        </>
      }
    />
  );
}
