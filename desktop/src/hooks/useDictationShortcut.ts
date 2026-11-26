import { useEffect, useLayoutEffect, useRef } from "react";

import type { Dictation } from "./useDictation";

/** A press held at least this long is push-to-talk: releasing it stops. */
export const HOLD_THRESHOLD_MS = 300;

let owners: symbol[] = [];

export function isDictationShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === "KeyD";
}

/**
 * ⌘⇧D (Ctrl⇧D elsewhere): a tap toggles recording, a hold records until
 * release. Matches on the physical key so it works in any keyboard layout.
 * With several composers mounted, the most recently mounted one answers.
 */
export function useDictationShortcut(dictation: Dictation, enabled: boolean) {
  const latest = useRef(dictation);
  useLayoutEffect(() => {
    latest.current = dictation;
  });

  useEffect(() => {
    if (!enabled) return;
    const me = Symbol("dictation");
    owners = [...owners, me];
    let pressedAt: number | null = null;
    let startedByPress = false;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isDictationShortcut(e) || owners[owners.length - 1] !== me) return;
      e.preventDefault();
      if (e.repeat) return;
      pressedAt = Date.now();
      startedByPress = latest.current.phase.kind === "idle";
      latest.current.toggle();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (pressedAt === null) return;
      if (
        ![
          "KeyD",
          "MetaLeft",
          "MetaRight",
          "ControlLeft",
          "ControlRight",
          "ShiftLeft",
          "ShiftRight",
        ].includes(e.code)
      ) {
        return;
      }
      const held = Date.now() - pressedAt;
      pressedAt = null;
      if (startedByPress && held >= HOLD_THRESHOLD_MS) void latest.current.stop();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      owners = owners.filter((owner) => owner !== me);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enabled]);
}
