import type { DaemonEvent, FileDoc, SessionUpdate, Snapshot, TaskDiff } from "../protocol";
import { bytesToBase64 } from "./base64";
import { DaemonEvents } from "./events";

const nowSecs = () => Math.floor(Date.now() / 1000);

export class DaemonDemo extends DaemonEvents {
  // ── demo mode (no daemon; used for UI review and `?demo` dev runs) ──
  protected demoDiff: ((taskId: string) => TaskDiff) | null = null;
  private demoFileDoc: ((path: string) => FileDoc) | null = null;

  enableDemoMode(seed: {
    snapshot: Snapshot;
    sessionUpdates: Record<string, SessionUpdate[]>;
    diffFor: (taskId: string) => TaskDiff;
    fileDocFor: (path: string) => FileDoc;
  }) {
    this.demoDiff = seed.diffFor;
    this.demoFileDoc = seed.fileDocFor;
    const sessionUpdates = this.stampSessionHistories(
      Object.fromEntries(
        Object.entries(seed.sessionUpdates).map(([taskId, updates]) => [
          taskId,
          updates.some((update) => update.kind === "prompt_capabilities")
            ? updates
            : [
                { embedded_context: true, image: true, kind: "prompt_capabilities" as const },
                ...updates,
              ],
        ]),
      ),
    );
    this.setState({
      connection: "connected",
      connectionError: null,
      sessionUpdates,
      snapshot: seed.snapshot,
    });
  }

  /** Inject a daemon event locally (demo mode only). */
  demoEvent(ev: DaemonEvent) {
    if (this.demoDiff) {
      this.applyEvent(ev);
    }
  }

  protected demoRequest(method: string, params?: unknown): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case "diff.get":
        return Promise.resolve(this.demoDiff!(String(p.task_id)));
      case "file.contents":
        return Promise.resolve(this.demoFileDoc!(String(p.path)));
      case "file.list": {
        const diff = this.demoDiff!(String(p.task_id));
        const files = diff.files.map((f) => ({ changed: true, path: f.path }));
        return Promise.resolve(files);
      }
      case "file.search":
        return Promise.resolve([]);
      case "file.save":
        return Promise.resolve({});
      case "lsp.detect":
        return Promise.resolve([]);
      case "lsp.install":
        return Promise.resolve({
          ok: false,
          command: "",
          output: "demo mode: install unavailable",
        });
      case "git.pushInfo": {
        const taskId = String(p.task_id);
        const task = this.state.snapshot.tasks.find((item) => item.id === taskId);
        return Promise.resolve({
          branch: "feature/demo-push",
          commits: [
            {
              hash: "7bc91e2d36d05a89f86e58d27060edeb36cf91c2",
              shortHash: "7bc91e2",
              subject: task?.prompt || "Improve workspace flow",
              author: "Warpforge Developer",
              files: this.demoDiff!(taskId).files.map((file) => ({
                path: file.path,
                status: file.status === "added" ? "A" : file.status === "deleted" ? "D" : "M",
              })),
            },
          ],
          hasUpstream: true,
          remote: "origin",
          remoteBranch: "feature/demo-push",
          upstream: "origin/feature/demo-push",
        });
      }
      case "git.push":
        return Promise.resolve({
          branch: "feature/demo-push",
          conflicts: [],
          message: p.force ? "pushed with force-with-lease" : "pushed to origin",
          status: "ok",
        });
      case "service.logs":
        return Promise.resolve([
          `[${String(p.service)}] starting process`,
          `[${String(p.service)}] loading workspace config`,
          `[${String(p.service)}] listening on allocated port`,
        ]);
      case "portforward.logs":
        return Promise.resolve([
          `[${String(p.name)}] resolving pod`,
          `[${String(p.name)}] starting kubectl port-forward`,
          `[${String(p.name)}] forwarding :${String(p.localPort ?? 8080)}`,
        ]);
      case "runtime.stopAll":
        return Promise.resolve({});
      case "session.permission": {
        const taskId = String(p.task_id);
        this.appendUpdate(taskId, {
          kind: "agent_text",
          text: `(permission ${String(p.outcome)} — continuing)`,
        });
        // Reflect the answer on the task so it leaves the attention rail.
        this.patchTask(taskId, (t) => ({ ...t, status: "running", updatedAt: nowSecs() }));
        return Promise.resolve({});
      }
      case "session.prompt": {
        const taskId = String(p.task_id);
        const attachments = Array.isArray(p.attachments)
          ? p.attachments.map((attachment: any) =>
              attachment.type === "file"
                ? { path: String(attachment.path), type: "file" as const }
                : attachment.type === "document"
                  ? { name: String(attachment.name), type: "document" as const }
                  : { name: String(attachment.name), type: "image" as const },
            )
          : [];
        this.appendUpdate(taskId, { attachments, kind: "user_message", text: String(p.text) });
        // Fake an agent acknowledgement shortly after.
        setTimeout(
          () =>
            this.appendUpdate(taskId, {
              kind: "agent_text",
              text: "Got it — adjusting course.",
            }),
          700,
        );
        return Promise.resolve({});
      }
      case "task.create": {
        const id = `t${Math.random().toString(36).slice(2, 7)}`;
        const promptText = String(p.prompt);
        const task = {
          agent: String(p.agent ?? "claude"),
          blockedReason: null,
          createdAt: nowSecs(),
          filesChanged: 0,
          id,
          project: String(p.project),
          prompt: promptText,
          origin: p.origin ? String(p.origin) : null,
          status: "running" as const,
          tags: (p.tags as string[]) ?? [],
          title: promptText.trim().split("\n")[0]?.trim().slice(0, 80) ?? "",
          updatedAt: nowSecs(),
        };
        this.applyEvent({ data: task, event: "task.created" });
        if (p.include_runtime_context) {
          this.appendUpdate(id, {
            kind: "agent_text",
            text: "Context received: services are up on their dev ports. Starting.",
          });
        }
        return Promise.resolve({ taskId: id });
      }
      case "task.cancel": {
        this.patchTask(String(p.task_id), (t) => ({
          ...t,
          status: "done",
          updatedAt: nowSecs(),
        }));
        return Promise.resolve({});
      }
      case "task.archive": {
        this.patchTask(String(p.task_id), (t) => ({
          ...t,
          status: "done",
          updatedAt: nowSecs(),
        }));
        return Promise.resolve({});
      }
      case "task.delete": {
        this.applyEvent({ data: { id: String(p.task_id) }, event: "task.removed" });
        return Promise.resolve({});
      }
      case "sessions.list":
        return Promise.resolve({ sessions: [] });
      case "orchestrate.start": {
        const graphId = `g${Math.random().toString(36).slice(2, 7)}`;
        const taskId = `t${Math.random().toString(36).slice(2, 7)}`;
        const goal = String(p.goal ?? "");
        // Create a parent task with orchestration graph
        const graph = {
          goal,
          id: graphId,
          nodes: [
            {
              id: `${graphId}_plan`,
              kind: "plan" as const,
              agent: "claude",
              status: "running" as const,
              taskId,
            },
          ],
        };
        const task = {
          agent: "claude",
          blockedReason: null,
          createdAt: nowSecs(),
          filesChanged: 0,
          id: taskId,
          orchestrationGraph: graph,
          project: String(p.project),
          prompt: goal,
          status: "running" as const,
          tags: ["orchestrator"],
          title: goal.trim().split("\n")[0]?.trim().slice(0, 80) ?? "",
          updatedAt: nowSecs(),
        };
        this.applyEvent({ data: task, event: "task.created" });
        return Promise.resolve({ graphId, taskId });
      }
      case "orchestrate.list": {
        const graphs: { goal: string; id: string; project: string; totalNodes: number }[] = [];
        for (const t of this.state.snapshot.tasks) {
          if (t.orchestrationGraph) {
            graphs.push({
              goal: t.orchestrationGraph.goal,
              id: t.orchestrationGraph.id,
              project: t.project,
              totalNodes: t.orchestrationGraph.nodes.length,
            });
          }
        }
        return Promise.resolve({ graphs });
      }
      case "terminal.spawn": {
        const id = `t${Math.random().toString(36).slice(2, 10)}`;
        // Synthesize a TerminalInfo entry so the workspace sees it.
        this.applyEvent({
          event: "state.snapshot",
          data: {
            ...this.state.snapshot,
            terminals: [
              ...this.state.snapshot.terminals,
              {
                cols: Number(p.cols) || 80,
                command: 'exec "${SHELL:-/bin/sh}" -l',
                id,
                project: String(p.project),
                rows: Number(p.rows) || 24,
                startedAt: nowSecs(),
              },
            ],
          },
        });
        // Emit a fake prompt via terminal.data.
        setTimeout(() => {
          const prompt = "$ ";
          const b64 = bytesToBase64(new TextEncoder().encode(prompt));
          this.applyEvent({
            event: "terminal.data",
            data: { data_b64: b64, terminal_id: id },
          });
        }, 50);
        return Promise.resolve({ terminalId: id });
      }
      case "terminal.input":
      case "terminal.resize":
      case "terminal.kill":
        return Promise.resolve({});
      default:
        return Promise.resolve({});
    }
  }
}
