import type {
  ReadProjectConfigResult,
  Space,
  SpaceMember,
  SpaceMemberKey,
  WriteProjectConfigParams,
  WriteProjectConfigResult,
} from "../protocol";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

export function ProjectMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  return class extends Base {
    async readProjectConfig(project: string): Promise<ReadProjectConfigResult> {
      return (await this.request("project.config.read", { project })) as ReadProjectConfigResult;
    }

    async writeProjectConfig(params: WriteProjectConfigParams): Promise<WriteProjectConfigResult> {
      return (await this.request("project.config.write", params)) as WriteProjectConfigResult;
    }

    async listSpaces(): Promise<Space[]> {
      return (await this.request("space.list", {})) as Space[];
    }

    async createSpace(name: string): Promise<Space> {
      return (await this.request("space.create", { name })) as Space;
    }

    async renameSpace(id: string, name: string): Promise<Space> {
      return (await this.request("space.rename", { id, name })) as Space;
    }

    async deleteSpace(id: string): Promise<Space> {
      return (await this.request("space.delete", { id })) as Space;
    }

    async addSpaceMember(id: string, member: SpaceMember): Promise<Space> {
      return (await this.request("space.addMember", { id, member })) as Space;
    }

    async removeSpaceMember(id: string, member: SpaceMemberKey): Promise<Space> {
      return (await this.request("space.removeMember", { id, member })) as Space;
    }

    /**
     * Register a folder as a project, optionally assigning its starting
     * ("sticky") port range — the same slot `warpforge add --ports` uses, not
     * a machine-local override. A `ports.range` the team later declares in the
     * project's config outranks it.
     */
    async addProject(path: string, name?: string, portRange?: string): Promise<{ name?: string }> {
      const result = await this.request("project.add", {
        path,
        name: name || undefined,
        port_range: portRange || undefined,
      });
      return result as { name?: string };
    }

    /** Remove a project registration, optionally authorizing resource teardown. */
    async removeProject(name: string, stopResources = false): Promise<void> {
      await this.request("project.remove", { name, stop_resources: stopResources });
    }

    /**
     * Set (or clear, passing no range) a project's machine-local port-range
     * override. Writes to the local registry only — never the shared config.
     * Rejects with the daemon's error when the range does not parse.
     */
    async setProjectPortRange(project: string, range?: string | null): Promise<void> {
      await this.request("project.setPortRange", { project, range: range ?? null });
    }
  };
}
