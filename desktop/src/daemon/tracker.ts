import type {
  LinearTeam,
  ProjectSources,
  TrackerProjectSettings,
  TrackerStatus,
} from "../protocol";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

export function TrackerMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  // ── Issue trackers (GitHub / Linear) ──────────────────────────────────────
  return class extends Base {
    /** Current connection state of both trackers. */
    async trackerStatus(): Promise<TrackerStatus> {
      return (await this.request("tracker.status", {})) as TrackerStatus;
    }

    /** Store a Linear personal API key (validated daemon-side, kept in the OS
     *  keychain — it never touches the renderer's storage). */
    async connectLinear(apiKey: string): Promise<TrackerStatus> {
      return (await this.request("tracker.connectLinear", {
        api_key: apiKey,
      })) as TrackerStatus;
    }

    async disconnectLinear(): Promise<TrackerStatus> {
      return (await this.request("tracker.disconnectLinear", {})) as TrackerStatus;
    }

    async connectGithub(token?: string): Promise<TrackerStatus> {
      return (await this.request("tracker.connectGithub", token ? { token } : {})) as TrackerStatus;
    }

    async disconnectGithub(): Promise<TrackerStatus> {
      return (await this.request("tracker.disconnectGithub", {})) as TrackerStatus;
    }

    /** Teams the connected Linear key can see, to point a project at one. */
    async linearTeams(): Promise<LinearTeam[]> {
      const result = (await this.request("tracker.linearTeams", {})) as { teams?: LinearTeam[] };
      return result.teams ?? [];
    }

    /**
     * One image embedded in an issue body, fetched by the daemon because this
     * WebView holds no tracker session of its own. Comes back as bytes, not a
     * URL: a signed attachment link expires within minutes.
     */
    async trackerAttachment(url: string): Promise<{ contentType: string; dataBase64: string }> {
      const result = (await this.request("tracker.attachment", { url })) as {
        contentType?: string;
        dataBase64?: string;
      };
      if (!result?.dataBase64) throw new Error("the daemon returned no image data");
      return {
        contentType: result.contentType || "application/octet-stream",
        dataBase64: result.dataBase64,
      };
    }

    /** Which tracker slice this project reads. */
    async trackerProjectSettings(project: string): Promise<TrackerProjectSettings> {
      const result = (await this.request("tracker.projectSettings", {
        project,
      })) as Partial<TrackerProjectSettings>;
      return { project, ...result };
    }

    /** Point a project at a Linear team, or `null` to stop importing Linear into
     *  it. Changing this drops the rows the previous team imported. */
    async setProjectLinearTeam(
      project: string,
      team: LinearTeam | null,
    ): Promise<TrackerProjectSettings> {
      const result = (await this.request("tracker.setProjectLinearTeam", {
        project,
        team_id: team?.id ?? null,
        team_name: team ? `${team.name}` : null,
      })) as Partial<TrackerProjectSettings>;
      return { project, ...result };
    }

    /** Which sources this project can actually read and write — the per-project
     *  availability the UI gates its filters and pickers on. */
    async trackerProjectSources(project: string): Promise<ProjectSources> {
      const result = (await this.request("tracker.projectSources", {
        project,
      })) as Partial<ProjectSources>;
      return { project, local: true, linear: false, github: false, ...result };
    }
  };
}
