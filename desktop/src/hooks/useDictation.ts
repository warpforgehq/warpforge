import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { DEFAULT_DICTATION_MODEL, dictation, pickInstalledModel } from "@/lib/dictation";
import { useVoice } from "@/store/voice";

export type DictationPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "recording"; level: number; elapsedMs: number }
  | { kind: "transcribing" }
  | { kind: "needsModel" }
  | { kind: "downloading"; downloaded: number; total: number };

export interface Dictation {
  phase: DictationPhase;
  /** Start when idle, stop and transcribe when recording. */
  toggle: () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
  downloadDefault: () => Promise<void>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Record-then-transcribe voice input. The transcript goes to `onTranscript`;
 * nothing is ever sent on the user's behalf.
 */
export function useDictation(onTranscript: (text: string) => void): Dictation {
  const [phase, setPhaseState] = useState<DictationPhase>({ kind: "idle" });
  const phaseRef = useRef(phase);
  const modelRef = useRef(DEFAULT_DICTATION_MODEL);
  const stopWhenStarted = useRef(false);
  const cancelWhenStarted = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  useLayoutEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  const setPhase = useCallback((next: DictationPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const stop = useCallback(async () => {
    const current = phaseRef.current.kind;
    if (current === "starting") {
      stopWhenStarted.current = true;
      return;
    }
    if (current !== "recording") return;
    setPhase({ kind: "transcribing" });
    const { language, customWords } = useVoice.getState();
    try {
      const text = await dictation.stop({ model: modelRef.current, language, customWords });
      if (text.trim()) onTranscriptRef.current(text);
      else toast.info("No speech was heard.");
    } catch (error) {
      toast.error(message(error));
    } finally {
      setPhase({ kind: "idle" });
    }
  }, [setPhase]);

  const cancel = useCallback(async () => {
    const current = phaseRef.current.kind;
    if (current === "starting") {
      cancelWhenStarted.current = true;
      return;
    }
    if (current === "needsModel") {
      setPhase({ kind: "idle" });
      return;
    }
    if (current !== "recording") return;
    setPhase({ kind: "idle" });
    try {
      await dictation.cancel();
    } catch (error) {
      toast.error(message(error));
    }
  }, [setPhase]);

  const start = useCallback(async () => {
    if (phaseRef.current.kind !== "idle") return;
    setPhase({ kind: "starting" });
    stopWhenStarted.current = false;
    cancelWhenStarted.current = false;
    try {
      const { model, device } = useVoice.getState();
      const installed = pickInstalledModel(await dictation.models(), model);
      if (!installed) {
        setPhase({ kind: cancelWhenStarted.current ? "idle" : "needsModel" });
        return;
      }
      modelRef.current = installed;
      await dictation.start(device);
    } catch (error) {
      toast.error(message(error));
      setPhase({ kind: "idle" });
      return;
    }
    setPhase({ kind: "recording", level: 0, elapsedMs: 0 });
    if (cancelWhenStarted.current) await cancel();
    else if (stopWhenStarted.current) await stop();
  }, [cancel, setPhase, stop]);

  const toggle = useCallback(() => {
    const current = phaseRef.current.kind;
    if (current === "idle") void start();
    else if (current === "recording" || current === "starting") void stop();
    else if (current === "needsModel") setPhase({ kind: "idle" });
  }, [setPhase, start, stop]);

  const downloadDefault = useCallback(async () => {
    setPhase({ kind: "downloading", downloaded: 0, total: 0 });
    try {
      await dictation.download(DEFAULT_DICTATION_MODEL);
      useVoice.getState().setModel(DEFAULT_DICTATION_MODEL);
      setPhase({ kind: "idle" });
      toast.success("Voice model ready. Press ⌘⇧D to dictate.");
    } catch (error) {
      toast.error(message(error));
      setPhase({ kind: "needsModel" });
    }
  }, [setPhase]);

  const recording = phase.kind === "recording";
  const downloading = phase.kind === "downloading";

  useEffect(() => {
    if (!recording) return;
    let unlisten: (() => void)[] = [];
    let live = true;
    void Promise.all([
      dictation.onLevel(({ level, elapsedMs }) => {
        if (phaseRef.current.kind === "recording") {
          setPhase({ kind: "recording", level, elapsedMs });
        }
      }),
      dictation.onLimit(() => void stop()),
    ]).then((fns) => {
      if (live) unlisten = fns;
      else fns.forEach((fn) => fn());
    });
    return () => {
      live = false;
      unlisten.forEach((fn) => fn());
    };
  }, [recording, setPhase, stop]);

  useEffect(() => {
    if (!downloading) return;
    let unlisten = () => {};
    let live = true;
    void dictation
      .onProgress(({ id, downloaded, total }) => {
        if (id === DEFAULT_DICTATION_MODEL && phaseRef.current.kind === "downloading") {
          setPhase({ kind: "downloading", downloaded, total });
        }
      })
      .then((fn) => {
        if (live) unlisten = fn;
        else fn();
      });
    return () => {
      live = false;
      unlisten();
    };
  }, [downloading, setPhase]);

  const active =
    phase.kind === "recording" || phase.kind === "starting" || phase.kind === "needsModel";
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      void cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, cancel]);

  useEffect(
    () => () => {
      if (phaseRef.current.kind === "recording") void dictation.cancel().catch(() => {});
    },
    [],
  );

  return { phase, toggle, start, stop, cancel, downloadDefault };
}
