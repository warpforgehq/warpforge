import { EMPTY_SNAPSHOT } from "../protocol";
import {
  MAX_TERMINAL_BUFFER_BYTES,
  MAX_TERMINAL_BUFFER_GLOBAL_BYTES,
  TERMINAL_BUFFER_TTL_MS,
  type DaemonState,
  type EventListener,
  type Listener,
  type TerminalDataListener,
} from "./types";

export class DaemonStore {
  protected listeners = new Set<Listener>();
  protected eventListeners = new Set<EventListener>();
  /** Tasks whose full conversation was already fetched via session.history. */
  protected historyLoads = new Map<string, Promise<void>>();
  protected toolCallStarts = new Map<string, number>();
  protected terminalDataSubscribers = new Map<string, Set<TerminalDataListener>>();
  protected terminalDataBuffers = new Map<
    string,
    { chunks: Array<{ data: Uint8Array; ts: number }>; bytes: number }
  >();
  protected state: DaemonState = {
    connection: "disconnected",
    connectionError: null,
    pendingAgentSetup: null,
    agentLimits: null,
    agentSpend: null,
    serviceLogs: {},
    portforwardLogs: {},
    sessionUpdates: {},
    snapshot: EMPTY_SNAPSHOT,
  };

  // ── external store interface (for useSyncExternalStore) ──
  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  subscribeEvents = (fn: EventListener): (() => void) => {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  };
  getState = (): DaemonState => this.state;

  subscribeTerminalData(terminalId: string, listener: TerminalDataListener): () => void {
    let subs = this.terminalDataSubscribers.get(terminalId);
    if (!subs) {
      subs = new Set();
      this.terminalDataSubscribers.set(terminalId, subs);
    }
    subs.add(listener);
    const buf = this.terminalDataBuffers.get(terminalId);
    if (buf) {
      for (const chunk of buf.chunks) listener(chunk.data);
      this.terminalDataBuffers.delete(terminalId);
    }
    return () => {
      const s = this.terminalDataSubscribers.get(terminalId);
      if (s) {
        s.delete(listener);
        if (s.size === 0) this.terminalDataSubscribers.delete(terminalId);
      }
    };
  }

  clearTerminalBuffer(terminalId: string) {
    this.terminalDataBuffers.delete(terminalId);
  }

  protected deliverTerminalData(terminalId: string, data: Uint8Array) {
    const subs = this.terminalDataSubscribers.get(terminalId);
    if (subs && subs.size > 0) {
      for (const listener of subs) listener(data);
      return;
    }
    let buf = this.terminalDataBuffers.get(terminalId);
    if (!buf) {
      buf = { chunks: [], bytes: 0 };
      this.terminalDataBuffers.set(terminalId, buf);
    }
    const now = Date.now();
    buf.chunks.push({ data, ts: now });
    buf.bytes += data.length;
    while (buf.chunks.length > 1 && buf.bytes > MAX_TERMINAL_BUFFER_BYTES) {
      const dropped = buf.chunks.shift()!;
      buf.bytes -= dropped.data.length;
    }
    this.pruneGlobalTerminalBuffers(now);
  }

  private pruneGlobalTerminalBuffers(now: number) {
    let globalBytes = 0;
    for (const buf of this.terminalDataBuffers.values()) globalBytes += buf.bytes;
    while (globalBytes > MAX_TERMINAL_BUFFER_GLOBAL_BYTES) {
      let oldestKey: string | null = null;
      let oldestTs = Infinity;
      for (const [key, buf] of this.terminalDataBuffers.entries()) {
        if (buf.chunks.length > 0 && buf.chunks[0].ts < oldestTs) {
          oldestTs = buf.chunks[0].ts;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      const ob = this.terminalDataBuffers.get(oldestKey)!;
      if (ob.chunks.length === 0) break;
      if (now - ob.chunks[0].ts > TERMINAL_BUFFER_TTL_MS || ob.chunks.length > 1) {
        const dropped = ob.chunks.shift()!;
        ob.bytes -= dropped.data.length;
        globalBytes -= dropped.data.length;
        if (ob.chunks.length === 0) {
          this.terminalDataBuffers.delete(oldestKey);
        }
      } else {
        break;
      }
    }
    for (const [key, buf] of this.terminalDataBuffers.entries()) {
      while (buf.chunks.length > 0 && now - buf.chunks[0].ts > TERMINAL_BUFFER_TTL_MS) {
        const dropped = buf.chunks.shift()!;
        buf.bytes -= dropped.data.length;
      }
      if (buf.chunks.length === 0) {
        this.terminalDataBuffers.delete(key);
      }
    }
  }

  protected setState(patch: Partial<DaemonState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
}
