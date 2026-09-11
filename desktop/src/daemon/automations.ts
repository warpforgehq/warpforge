import type { Automation, AutomationInput, AutomationPatch, AutomationRun } from "../protocol";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

export function AutomationMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  // ── Automation RPCs ──
  // Automations are deliberately absent from the connect snapshot, so every
  // automation view fetches them and then stays live off the three
  // `automation.*` events.
  return class extends Base {
    async listAutomations(project?: string | null): Promise<Automation[]> {
      const result = await this.request("automation.list", { project: project ?? null });
      const automations = (result as { automations?: Automation[] })?.automations;
      return Array.isArray(automations) ? automations : [];
    }

    async showAutomation(id: string): Promise<Automation> {
      return (await this.request("automation.show", { id })) as Automation;
    }

    async createAutomation(input: AutomationInput): Promise<Automation> {
      return (await this.request("automation.create", {
        project: input.project,
        name: input.name,
        prompt: input.prompt,
        agent: input.agent,
        model: input.model ?? null,
        config_overrides: input.configOverrides ?? {},
        trigger: input.trigger,
        timezone: input.timezone,
        precheck: input.precheck ?? null,
        enabled: input.enabled,
        missed_run_grace_minutes: input.missedRunGraceMinutes,
        reuse_session: input.reuseSession,
        worktree: input.worktree,
      })) as Automation;
    }

    /** Patch an automation; the daemon returns the stored row. See
     *  `AutomationPatch` for why clearing a field is not `null`. */
    async updateAutomation(id: string, patch: AutomationPatch): Promise<Automation> {
      return (await this.request("automation.update", { id, patch })) as Automation;
    }

    async deleteAutomation(id: string): Promise<void> {
      await this.request("automation.delete", { id });
    }

    /** Run now: skips the precheck and the missed-run grace check, but still
     *  refuses to overlap a live run, and does not move the next occurrence. */
    async runAutomationNow(id: string): Promise<AutomationRun> {
      return (await this.request("automation.runNow", { id })) as AutomationRun;
    }

    async automationRuns(id: string, limit = 25): Promise<AutomationRun[]> {
      const result = await this.request("automation.runs", { id, limit });
      const runs = (result as { runs?: AutomationRun[] })?.runs;
      return Array.isArray(runs) ? runs : [];
    }
  };
}
