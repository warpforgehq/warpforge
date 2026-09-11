import type { DaemonEndpoint, DaemonHandshake, ServerMessage, UpdateHandoff } from "../protocol";
import { isEvent } from "../protocol";
import { DaemonDemo } from "./demo";
import { connectionErrorMessage, desktopVersion, discoverEndpoint } from "./discover";
import {
  DAEMON_PROTOCOL_VERSION,
  REQUEST_TIMEOUT_MS,
  SLOW_METHODS,
  SLOW_REQUEST_TIMEOUT_MS,
} from "./types";

export class CoreClient extends DaemonDemo {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }
  >();
  private reconnectDelay = 500;
  private reconnectTimer: number | null = null;
  private reconnectSuspended = false;
  private handshake: DaemonHandshake | null = null;

  // ── connection ──
  async connect(): Promise<void> {
    if (this.reconnectSuspended || this.state.connection !== "disconnected") return;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setState({ connection: "connecting" });
    let endpoint: DaemonEndpoint;
    try {
      endpoint = await discoverEndpoint();
    } catch (error) {
      this.setState({
        connection: "disconnected",
        connectionError: connectionErrorMessage(error),
      });
      this.scheduleReconnect();
      throw error;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(endpoint.url);
    } catch (error) {
      this.setState({
        connection: "disconnected",
        connectionError: connectionErrorMessage(error),
      });
      this.scheduleReconnect();
      throw error;
    }
    this.ws = ws;

    ws.onopen = async () => {
      if (endpoint.token) {
        ws.send(JSON.stringify({ auth: endpoint.token }));
      }
      try {
        const clientVersion = await desktopVersion();
        const handshake = (await this.request("system.handshake", {
          client_version: clientVersion,
          protocol_version: DAEMON_PROTOCOL_VERSION,
        })) as DaemonHandshake;
        const requiresExactVersion = clientVersion !== "dev";
        if (
          !handshake.protocolCompatible ||
          (requiresExactVersion && !handshake.exactVersionMatch)
        ) {
          throw new Error(
            !handshake.protocolCompatible
              ? `daemon protocol ${handshake.protocolVersion} is incompatible with desktop protocol ${DAEMON_PROTOCOL_VERSION}`
              : `daemon version ${handshake.daemonVersion} does not match this desktop app (${clientVersion})`,
          );
        }
        this.handshake = handshake;
        this.setState({ connection: "connected", connectionError: null });
        this.reconnectDelay = 500;
        await this.request("state.subscribe", { topics: [] });
      } catch (error) {
        this.setState({ connectionError: connectionErrorMessage(error) });
        ws.close();
      }
    };
    ws.onmessage = (msg) => {
      const parsed = JSON.parse(msg.data as string) as ServerMessage;
      this.handleMessage(parsed);
    };
    ws.onclose = () => this.scheduleReconnect();
    ws.onerror = () => {
      this.setState({
        connectionError: "Could not connect to the daemon. Warpforge will keep retrying.",
      });
      ws.close();
    };
  }

  private scheduleReconnect() {
    this.ws = null;
    this.handshake = null;
    this.setState({
      connection: "disconnected",
      ...(!this.state.connectionError && !this.reconnectSuspended
        ? { connectionError: "Daemon disconnected. Warpforge will keep retrying." }
        : {}),
    });
    this.pending.forEach((p) => {
      window.clearTimeout(p.timer);
      p.reject(new Error("daemon disconnected"));
    });
    this.pending.clear();
    this.terminalDataBuffers.clear();
    if (this.reconnectSuspended || this.reconnectTimer !== null) {
      return;
    }
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, 15_000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {
        // Endpoint discovery failures schedule their own retry. WebSocket
        // failures flow through onclose and do the same.
      });
    }, delay);
  }

  // ── RPC ──
  request(method: string, params?: unknown): Promise<unknown> {
    if (this.demoDiff) {
      return this.demoRequest(method, params);
    }
    if (method !== "system.handshake" && this.state.connection !== "connected") {
      return Promise.reject(new Error("daemon handshake has not completed"));
    }
    const { ws } = this;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("not connected to daemon"));
    }
    const id = this.nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const limit = SLOW_METHODS.has(method) ? SLOW_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} did not answer within ${Math.round(limit / 1000)}s`));
      }, limit);
      this.pending.set(id, { reject, resolve, timer });
    });
  }

  private handleMessage(msg: ServerMessage) {
    if (isEvent(msg)) {
      this.applyEvent(msg);
      return;
    }
    const pending = this.pending.get(msg.id);
    if (!pending) {
      return;
    }
    this.pending.delete(msg.id);
    window.clearTimeout(pending.timer);
    if ("error" in msg) {
      pending.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
    } else {
      pending.resolve(msg.result);
    }
  }

  async prepareUpdateHandoff(): Promise<UpdateHandoff> {
    if (!this.handshake) {
      throw new Error("The daemon handshake has not completed");
    }
    if (this.handshake.owner !== "desktop") {
      throw new Error(
        "This daemon was started outside the desktop app. Stop it and relaunch Warpforge before updating.",
      );
    }
    this.reconnectSuspended = true;
    try {
      const handoff = (await this.request("update.prepareShutdown", {
        expected_daemon_version: this.handshake.daemonVersion,
        protocol_version: DAEMON_PROTOCOL_VERSION,
      })) as UpdateHandoff;
      if (!handoff.ready) {
        this.reconnectSuspended = false;
      }
      return handoff;
    } catch (error) {
      this.reconnectSuspended = false;
      throw error;
    }
  }

  waitForDisconnect(timeoutMs = 5_000): Promise<void> {
    if (
      this.state.connection === "disconnected" ||
      !this.ws ||
      this.ws.readyState === WebSocket.CLOSED
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        unsubscribe();
        reject(new Error("The daemon did not stop in time; the update was not installed"));
      }, timeoutMs);
      const unsubscribe = this.subscribe(() => {
        if (this.state.connection === "disconnected") {
          window.clearTimeout(timeout);
          unsubscribe();
          resolve();
        }
      });
    });
  }

  resumeAfterFailedUpdate() {
    this.reconnectSuspended = false;
    if (this.state.connection === "disconnected") {
      void this.connect().catch(() => {
        // connect() owns retry scheduling.
      });
    }
  }
}
