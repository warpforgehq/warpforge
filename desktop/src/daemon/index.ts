/**
 * WebSocket client for the warpforge daemon plus a minimal external store.
 *
 * The shell is a thin client by design: this module is the ONLY place that
 * talks to the daemon, and views subscribe to the store it maintains. There
 * is no business logic here — just request/response correlation and applying
 * daemon events onto the last snapshot.
 *
 * The client is assembled from one core (connection, RPC, event projection,
 * demo mode) plus one mixin per RPC domain, composed bottom-up below.
 */

import { AgentMethods } from "./agents";
import { AutomationMethods } from "./automations";
import { BacklogMethods } from "./backlog";
import { CoreClient } from "./client";
import { MemoryMethods } from "./memory";
import { OrchestrationMethods } from "./orchestration";
import { ProjectMethods } from "./projects";
import { PullMethods } from "./pulls";
import { RuntimeMethods } from "./runtime";
import { SessionMethods } from "./sessions";
import { TaskMethods } from "./tasks";
import { TerminalMethods } from "./terminals";
import { TextMethods } from "./text";
import { TrackerMethods } from "./tracker";
import { WorkItemMethods } from "./workItems";

export { base64ToBytes, bytesToBase64 } from "./base64";
export { DAEMON_PROTOCOL_VERSION } from "./types";
export type { ConnectionState, DaemonState, TerminalDataListener } from "./types";

const ComposedClient = TerminalMethods(
  AutomationMethods(
    OrchestrationMethods(
      ProjectMethods(
        RuntimeMethods(
          TaskMethods(
            MemoryMethods(
              BacklogMethods(
                WorkItemMethods(
                  PullMethods(
                    TrackerMethods(TextMethods(AgentMethods(SessionMethods(CoreClient)))),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
);

export class DaemonClient extends ComposedClient {}

export const daemon = new DaemonClient();
