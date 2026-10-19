import { factory } from "./factory";
import { orchestrate } from "./orchestrate";
import { pulls } from "./pulls";
import type { Scene } from "./types";

export const SCENES: Scene[] = [orchestrate, factory, pulls];

/**
 * @param id A scene id, possibly from a URL or a message.
 * @returns That scene, or the first one when the id is unknown.
 */
export function sceneById(id: string | null | undefined): Scene {
  return SCENES.find((scene) => scene.id === id) ?? SCENES[0];
}

export type { Scene };
