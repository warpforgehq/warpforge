import { bytesToBase64 } from "./base64";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

export function TerminalMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  // ── Terminal PTY RPCs ──
  return class extends Base {
    async spawnTerminal(project: string, cols: number, rows: number): Promise<string> {
      const result = await this.request("terminal.spawn", {
        project,
        command: 'exec "${SHELL:-/bin/sh}" -l',
        cols,
        rows,
      });
      return (result as { terminalId?: string })?.terminalId ?? "";
    }

    sendTerminalInput(terminalId: string, data: Uint8Array) {
      this.request("terminal.input", {
        terminal_id: terminalId,
        data_b64: bytesToBase64(data),
      }).catch(() => {});
    }

    resizeTerminal(terminalId: string, cols: number, rows: number) {
      this.request("terminal.resize", {
        terminal_id: terminalId,
        cols,
        rows,
      }).catch(() => {});
    }

    async killTerminal(terminalId: string): Promise<void> {
      await this.request("terminal.kill", { terminal_id: terminalId });
    }
  };
}
