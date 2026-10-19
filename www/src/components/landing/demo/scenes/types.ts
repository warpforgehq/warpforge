import type {
  Channel,
  DaemonEvent,
  FileDoc,
  PeerMessage,
  SessionUpdate,
  Smith,
  Snapshot,
  TaskDiff,
} from "@app/protocol";
import type { TaskSurface, UiState } from "@app/store/ui";

import type { SceneId } from "./meta";

/** A daemon event for the reducer, or a navigation the visitor could have made. */
export type Beat = {
  /** Milliseconds to wait before dispatching this beat. */
  after: number;
} & ({ event: DaemonEvent } | { ui: Partial<UiState> });

/** What `daemon.enableDemoMode` is seeded with. */
export interface Seed {
  diffFor: (taskId: string) => TaskDiff;
  fileDocFor: (path: string) => FileDoc;
  sessionUpdates: Record<string, SessionUpdate[]>;
  snapshot: Snapshot;
  /** What the Smiths and peer-feed stores start with. */
  smiths?: Smith[];
  channels?: Channel[];
  peerMessages?: PeerMessage[];
}


/**
 * One story the demo can tell: the world it starts in, the events it replays
 * through the reducer, and any RPCs it answers beyond demo mode's own.
 */
export interface Scene {
  id: SceneId;
  /** Called on every (re)start, so each pass begins from a fresh world. */
  seed: () => Seed;
  /** Built after each seed, so it can refer to what that seed made. */
  script: () => Beat[];
  /** Milliseconds the finished run stays on screen before it replays. */
  hold?: number;
  /** The task open in the detail pane when the scene starts. */
  openTaskId: string | null;
  /** Where the scene starts in the shell; reapplied on every replay. */
  nav?: Partial<UiState>;
  /** UI state applied when the scene is picked, over the demo's defaults. */
  ui?: Partial<UiState>;
  /** The task surface shown once the start-up navigation has settled. */
  surface?: TaskSurface;
  /** Answers a request, or returns `undefined` to fall through to demo mode. */
  request?: (method: string, params?: unknown) => Promise<unknown> | undefined;
}
