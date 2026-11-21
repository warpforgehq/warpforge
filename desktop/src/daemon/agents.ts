import type {
  AccountInfo,
  AgentAccountLimits,
  AgentConfig,
  AgentSpend,
  DetectedAgent,
  DetectedLanguageServer,
} from "../protocol";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

/** Result of an install/update, including whether the agent was proven to start. */
export interface InstallAgentResult {
  ok: boolean;
  command: string;
  output: string;
  /** The daemon ran the agent's ACP handshake after installing and it answered. */
  verified: boolean;
  /** Why the agent could not start, when `verified` is false. */
  verifyError: string | null;
  /** The one-line reason to show, when the failure is a broken install. */
  summary: string | null;
  /** The failure is a broken install (missing native binary), not a config issue. */
  brokenInstall: boolean;
  /** A clean reinstall was run automatically to repair a broken install. */
  repaired: boolean;
}

export function AgentMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  return class extends Base {
    async detectAgents(): Promise<DetectedAgent[]> {
      const result = await this.request("agents.detect", {});
      const detected = Array.isArray(result) ? (result as DetectedAgent[]) : [];
      const seeded = Object.fromEntries(detected.map((a) => [a.id, a.brokenInstall ?? null]));
      this.setState({ agentHealth: { ...this.state.agentHealth, ...seeded } });
      return detected;
    }

    async saveAgents(agents: AgentConfig[]) {
      await this.request("agents.update", { agents });
    }

    /** Re-read an agent's model list from its harness. Rejects if the probe
     *  fails; the refreshed list arrives separately as `agents.updated`. */
    async probeAgent(id: string) {
      await this.request("agents.probe", { id });
    }

    // ── Agent accounts ──
    // Every mutation answers with the full list, so callers replace rather than
    // patch; the daemon also broadcasts `accounts.updated` for other clients.

    async listAccounts(): Promise<AccountInfo[]> {
      const result = (await this.request("accounts.list", {})) as { accounts?: AccountInfo[] };
      return result?.accounts ?? [];
    }

    // Method names are camelCase; their *params* are snake_case, matching the
    // Rust variant fields (`rename_all` on the Method enum renames variants, not
    // fields). A mismatch makes the daemon drop the frame with no reply.
    async importAccount(agentId: string, label: string): Promise<AccountInfo[]> {
      const result = (await this.request("accounts.import", { agent_id: agentId, label })) as {
        accounts?: AccountInfo[];
      };
      return result?.accounts ?? [];
    }

    async renameAccount(accountId: string, label: string): Promise<AccountInfo[]> {
      const result = (await this.request("accounts.rename", { account_id: accountId, label })) as {
        accounts?: AccountInfo[];
      };
      return result?.accounts ?? [];
    }

    async removeAccount(accountId: string): Promise<AccountInfo[]> {
      const result = (await this.request("accounts.remove", { account_id: accountId })) as {
        accounts?: AccountInfo[];
      };
      return result?.accounts ?? [];
    }

    async setActiveAccount(agentId: string, accountId: string): Promise<AccountInfo[]> {
      const result = (await this.request("accounts.setActive", {
        account_id: accountId,
        agent_id: agentId,
      })) as {
        accounts?: AccountInfo[];
      };
      return result?.accounts ?? [];
    }

    /** Latest per-account harness rate limits. `refresh` forces the daemon to
     *  re-query its harnesses; without it a cached copy may answer. Rejects
     *  when the daemon does not support the call — the UI degrades to "no data". */
    async listAgentLimits(refresh = false): Promise<AgentAccountLimits[]> {
      const result = (await this.request("listAgentLimits", { refresh })) as {
        accounts?: AgentAccountLimits[];
      };
      const accounts = Array.isArray(result?.accounts) ? result.accounts : [];
      this.setState({ agentLimits: accounts });
      return accounts;
    }

    /** API-equivalent spend per harness — what the usage would cost at API
     *  rates, not an amount billed. Request-only: the daemon pushes no spend
     *  event, so callers ask when they mount. Rejects when the daemon does not
     *  support the call — the UI degrades to "no data". */
    async listAgentSpend(): Promise<AgentSpend[]> {
      const result = (await this.request("listAgentSpend", {})) as {
        agents?: AgentSpend[];
      };
      const agents = Array.isArray(result?.agents) ? result.agents : [];
      this.setState({ agentSpend: agents });
      return agents;
    }

    /** Install or update an agent's global package, then verify it starts.
     *  `clean` skips straight to a removal + reinstall — the repair for an
     *  install whose platform optional dependencies are missing. */
    async installAgent(id: string, clean = false): Promise<InstallAgentResult> {
      const result = (await this.request("agents.install", { id, clean })) as InstallAgentResult;
      return result;
    }

    /** Start Antigravity's Google sign-in; resolves with the link to open. */
    async startAgentSignIn(id: string): Promise<string> {
      const result = (await this.request("agents.signInStart", { id })) as { url: string };
      return result.url;
    }

    /** Pass the code the Antigravity page shows, then check the agent starts. */
    async finishAgentSignIn(
      id: string,
      code: string,
    ): Promise<{ verified: boolean; verifyError: string | null }> {
      return (await this.request("agents.signInFinish", { id, code })) as {
        verified: boolean;
        verifyError: string | null;
      };
    }

    /** Detect the install/update state of every supported language server. */
    async detectLanguageServers(): Promise<DetectedLanguageServer[]> {
      const result = (await this.request("lsp.detect", {})) as DetectedLanguageServer[];
      return Array.isArray(result) ? result : [];
    }

    /** Install (or update) a supported language server by id. */
    async installLanguageServer(id: string): Promise<{
      ok: boolean;
      command: string;
      output: string;
    }> {
      const result = (await this.request("lsp.install", { id })) as {
        ok: boolean;
        command: string;
        output: string;
      };
      return result;
    }
  };
}
