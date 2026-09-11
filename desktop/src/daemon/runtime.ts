import type { CoreClient } from "./client";
import { MAX_PORTFORWARD_LOGS, MAX_SERVICE_LOGS, type Constructor } from "./types";

export function RuntimeMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  return class extends Base {
    async stopRuntime() {
      await this.request("runtime.stopAll", {});
    }

    async fetchServiceLogs(
      project: string,
      service: string,
      options: { after?: number; limit?: number } = {},
    ): Promise<string[]> {
      const result = await this.request("service.logs", {
        after: options.after ?? 0,
        limit: options.limit ?? 300,
        project,
        service,
      });
      const payload = result as { lines?: unknown };
      const rawLines = Array.isArray(result)
        ? result
        : Array.isArray(payload?.lines)
          ? payload.lines
          : [];
      const lines = rawLines.map(String);
      const key = `${project}/${service}`;
      this.setState({
        serviceLogs: {
          ...this.state.serviceLogs,
          [key]: lines.slice(-MAX_SERVICE_LOGS),
        },
      });
      return lines;
    }

    async fetchPortForwardLogs(
      project: string,
      name: string,
      options: { after?: number; limit?: number } = {},
    ): Promise<string[]> {
      const result = await this.request("portforward.logs", {
        after: options.after ?? 0,
        limit: options.limit ?? 300,
        project,
        name,
      });
      const payload = result as { lines?: unknown };
      const rawLines = Array.isArray(result)
        ? result
        : Array.isArray(payload?.lines)
          ? payload.lines
          : [];
      const lines = rawLines.map(String);
      const key = `${project}/${name}`;
      this.setState({
        portforwardLogs: {
          ...this.state.portforwardLogs,
          [key]: lines.slice(-MAX_PORTFORWARD_LOGS),
        },
      });
      return lines;
    }
  };
}
