import { appendCoalescedUpdate, coalesceUpdates } from "../lib/sessionStream";
import { stampSessionHistoryStartTimes } from "../lib/sessionTiming";
import type { DaemonEvent, SessionUpdate, TaskInfo } from "../protocol";
import { queryClient } from "../query";
import { base64ToBytes } from "./base64";
import { DaemonStore } from "./store";
import { MAX_PORTFORWARD_LOGS, MAX_SERVICE_LOGS } from "./types";

export class DaemonEvents extends DaemonStore {
  protected appendUpdate(taskId: string, update: SessionUpdate) {
    const updates = this.state.sessionUpdates[taskId] ?? [];
    const stamped = this.stampSessionUpdate(taskId, update);
    this.setState({
      sessionUpdates: {
        ...this.state.sessionUpdates,
        [taskId]: appendCoalescedUpdate(updates, stamped),
      },
    });
  }

  private stampSessionUpdate(taskId: string, update: SessionUpdate): SessionUpdate {
    if (update.kind !== "tool_call") return update;
    const key = `${taskId}\0${update.tool_call_id}`;
    const startedAt = update.started_at ?? this.toolCallStarts.get(key) ?? Date.now();
    this.toolCallStarts.set(key, startedAt);
    return update.started_at === startedAt ? update : { ...update, started_at: startedAt };
  }

  protected stampSessionHistories(histories: Record<string, SessionUpdate[]>) {
    this.toolCallStarts.clear();
    return Object.fromEntries(
      Object.entries(histories).map(([taskId, updates]) => {
        const stamped = stampSessionHistoryStartTimes(coalesceUpdates(updates));
        for (const update of stamped) {
          if (update.kind === "tool_call" && update.started_at !== undefined) {
            this.toolCallStarts.set(`${taskId}\0${update.tool_call_id}`, update.started_at);
          }
        }
        return [taskId, stamped];
      }),
    );
  }

  protected patchTask(id: string, fn: (t: TaskInfo) => TaskInfo) {
    const task = this.state.snapshot.tasks.find((t) => t.id === id);
    if (task) {
      this.applyEvent({ event: "task.updated", data: fn(task) });
    }
  }

  // ── event → state ──
  protected applyEvent(ev: DaemonEvent) {
    this.eventListeners.forEach((listener) => listener(ev));
    const snap = this.state.snapshot;
    switch (ev.event) {
      case "state.snapshot": {
        // The snapshot carries no transcripts (docs/adr/0005); a fresh
        // snapshot means a fresh connection, so transcripts must be fetched
        // again for any chat opened from here on.
        this.historyLoads.clear();
        this.setState({ snapshot: ev.data });
        break;
      }
      case "project.added":
        this.setState({
          snapshot: { ...snap, projects: [...snap.projects, ev.data] },
        });
        break;
      case "project.removed":
        for (const terminal of snap.terminals) {
          if (terminal.project === ev.data.name) {
            this.clearTerminalBuffer(terminal.id);
          }
        }
        this.setState({
          snapshot: {
            ...snap,
            projects: snap.projects.filter((p) => p.name !== ev.data.name),
            services: snap.services.filter((service) => service.project !== ev.data.name),
            portforwards: snap.portforwards.filter(
              (portforward) => portforward.project !== ev.data.name,
            ),
            terminals: snap.terminals.filter((terminal) => terminal.project !== ev.data.name),
          },
          serviceLogs: Object.fromEntries(
            Object.entries(this.state.serviceLogs).filter(
              ([key]) => !key.startsWith(`${ev.data.name}/`),
            ),
          ),
          portforwardLogs: Object.fromEntries(
            Object.entries(this.state.portforwardLogs).filter(
              ([key]) => !key.startsWith(`${ev.data.name}/`),
            ),
          ),
        });
        break;
      case "project.configChanged": {
        const { project, services, portforwards } = ev.data;
        const exists = snap.projects.some((item) => item.name === project.name);
        this.setState({
          snapshot: {
            ...snap,
            projects: exists
              ? snap.projects.map((item) => (item.name === project.name ? project : item))
              : [...snap.projects, project],
            services: [
              ...snap.services.filter((item) => item.project !== project.name),
              ...services,
            ],
            portforwards: [
              ...snap.portforwards.filter((item) => item.project !== project.name),
              ...portforwards,
            ],
          },
        });
        break;
      }
      case "service.status": {
        const exists = snap.services.some(
          (s) => s.project === ev.data.project && s.name === ev.data.service,
        );
        const services = exists
          ? snap.services.map((s) =>
              s.project === ev.data.project && s.name === ev.data.service
                ? { ...s, allocatedPort: ev.data.allocated_port, status: ev.data.status }
                : s,
            )
          : // A service started after we subscribed — add it. command/originalPort
            // Fill in on the next full snapshot; status + port are what matter now.
            [
              ...snap.services,
              {
                allocatedPort: ev.data.allocated_port,
                command: "",
                logSeq: 0,
                name: ev.data.service,
                originalPort: 0,
                project: ev.data.project,
                status: ev.data.status,
              },
            ];
        this.setState({ snapshot: { ...snap, services } });
        break;
      }
      case "portforward.status":
        this.setState({
          snapshot: {
            ...snap,
            portforwards: snap.portforwards.map((pf) =>
              pf.project === ev.data.project && pf.name === ev.data.name
                ? { ...pf, status: ev.data.status }
                : pf,
            ),
          },
        });
        break;
      case "task.created":
        this.setState({
          snapshot: { ...snap, tasks: [...snap.tasks, ev.data] },
        });
        break;
      case "task.updated":
        this.setState({
          snapshot: {
            ...snap,
            tasks: snap.tasks.map((t) => (t.id === ev.data.id ? ev.data : t)),
          },
        });
        break;
      case "task.removed": {
        const prefix = `${ev.data.id}\0`;
        this.historyLoads.delete(ev.data.id);
        for (const key of this.toolCallStarts.keys()) {
          if (key.startsWith(prefix)) this.toolCallStarts.delete(key);
        }
        const { [ev.data.id]: _dropped, ...sessionUpdates } = this.state.sessionUpdates;
        this.setState({
          sessionUpdates,
          snapshot: { ...snap, tasks: snap.tasks.filter((t) => t.id !== ev.data.id) },
        });
        void queryClient.invalidateQueries({ queryKey: ["backlog"] });
        break;
      }
      case "session.update": {
        // Keep the full semantic history, but fold sub-word text chunks and
        // repeated tool lifecycle frames instead of retaining transport noise.
        const { task_id, update } = ev.data;
        const existing = this.state.sessionUpdates[task_id] ?? [];
        const stamped = this.stampSessionUpdate(task_id, update);
        this.setState({
          sessionUpdates: {
            ...this.state.sessionUpdates,
            [task_id]: appendCoalescedUpdate(existing, stamped),
          },
        });
        break;
      }
      case "service.log": {
        const key = `${ev.data.project}/${ev.data.service}`;
        const existing = this.state.serviceLogs[key] ?? [];
        const trimmed = [...existing, ev.data.line].slice(-MAX_SERVICE_LOGS);
        this.setState({ serviceLogs: { ...this.state.serviceLogs, [key]: trimmed } });
        break;
      }
      case "portforward.log": {
        const key = `${ev.data.project}/${ev.data.name}`;
        const existing = this.state.portforwardLogs[key] ?? [];
        const trimmed = [...existing, ev.data.line].slice(-MAX_PORTFORWARD_LOGS);
        this.setState({ portforwardLogs: { ...this.state.portforwardLogs, [key]: trimmed } });
        break;
      }
      case "agents.setup_needed":
        this.setState({ pendingAgentSetup: ev.data.detected });
        break;
      case "agents.updated":
        this.setState({
          pendingAgentSetup: null,
          snapshot: { ...snap, agents: ev.data.agents },
        });
        break;
      case "accounts.updated":
        this.setState({ snapshot: { ...snap, accounts: ev.data.accounts } });
        break;
      case "agentLimits.updated":
        this.setState({ agentLimits: ev.data.accounts });
        break;
      // Screen snapshots consumed by TUI clients; desktop uses terminal.data.
      case "terminal.screen":
        break;
      case "terminal.spawned": {
        const info = ev.data;
        const exists = snap.terminals.some((t) => t.id === info.id);
        if (!exists) {
          this.setState({ snapshot: { ...snap, terminals: [...snap.terminals, info] } });
        }
        break;
      }
      case "terminal.data": {
        const bytes = base64ToBytes(ev.data.data_b64);
        if (bytes.length > 0) this.deliverTerminalData(ev.data.terminal_id, bytes);
        break;
      }
      case "terminal.exited": {
        const { terminal_id } = ev.data;
        this.clearTerminalBuffer(terminal_id);
        const remaining = snap.terminals.filter((t) => t.id !== terminal_id);
        if (remaining.length !== snap.terminals.length) {
          this.setState({ snapshot: { ...snap, terminals: remaining } });
        }
        break;
      }
      // ── Orchestration events: update parent task's orchestrationGraph ──
      case "orchestration.nodeDispatched":
      case "orchestration.nodeCompleted":
      case "orchestration.nodeFailed":
      case "orchestration.allComplete":
        // The parent task is updated via task.updated events from the daemon.
        // These events are consumed by the UI for real-time graph updates.
        break;
    }
  }

  dismissAgentSetup() {
    this.setState({ pendingAgentSetup: null });
  }
}
