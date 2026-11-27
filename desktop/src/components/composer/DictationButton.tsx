import { Loader2, Mic, Square, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Dictation } from "@/hooks/useDictation";
import {
  DEFAULT_DICTATION_MODEL_BYTES,
  formatBytes,
  formatElapsed,
  MAX_RECORDING_MS,
} from "@/lib/dictation";

const BARS = [
  { id: "l2", weight: 0.35 },
  { id: "l1", weight: 0.7 },
  { id: "c", weight: 1 },
  { id: "r1", weight: 0.7 },
  { id: "r2", weight: 0.35 },
];

function LevelMeter({ level }: { level: number }) {
  const scaled = Math.min(1, Math.sqrt(level) * 1.4);
  return (
    <span className="flex h-3 items-center gap-[2px]" aria-hidden>
      {BARS.map(({ id, weight }) => (
        <span
          key={id}
          className="w-[2px] rounded-full bg-destructive transition-[height] duration-75"
          style={{ height: `${Math.max(2, Math.round(12 * scaled * weight))}px` }}
        />
      ))}
    </span>
  );
}

export function DictationButton({
  dictation,
  disabled,
}: {
  dictation: Dictation;
  disabled: boolean;
}) {
  const { phase } = dictation;

  if (phase.kind === "recording") {
    const nearLimit = phase.elapsedMs > MAX_RECORDING_MS - 30_000;
    return (
      <span
        role="status"
        aria-label="Recording"
        className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-1.5 py-0.5 text-destructive"
      >
        <span className="size-1.5 animate-pulse rounded-full bg-destructive" aria-hidden />
        <LevelMeter level={phase.level} />
        <span className={nearLimit ? "font-semibold tabular-nums" : "tabular-nums"}>
          {formatElapsed(phase.elapsedMs)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-5 text-destructive [&_svg]:size-3"
          title="Stop and insert text (⌘⇧D)"
          aria-label="Stop dictation"
          onClick={() => void dictation.stop()}
        >
          <Square />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-5 [&_svg]:size-3"
          title="Discard recording (Esc)"
          aria-label="Cancel dictation"
          onClick={() => void dictation.cancel()}
        >
          <X />
        </Button>
      </span>
    );
  }

  if (phase.kind === "transcribing" || phase.kind === "starting") {
    return (
      <span role="status" className="flex items-center gap-1">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        {phase.kind === "transcribing" ? "Transcribing…" : null}
      </span>
    );
  }

  if (phase.kind === "needsModel") {
    return (
      <span className="flex items-center gap-1.5">
        <span>Voice input needs a speech model.</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-5 px-1.5 text-[11px]"
          onClick={() => void dictation.downloadDefault()}
        >
          Download ({formatBytes(DEFAULT_DICTATION_MODEL_BYTES)})
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-5 [&_svg]:size-3"
          aria-label="Not now"
          onClick={() => void dictation.cancel()}
        >
          <X />
        </Button>
      </span>
    );
  }

  if (phase.kind === "downloading") {
    const percent = phase.total ? Math.floor((phase.downloaded / phase.total) * 100) : 0;
    return (
      <span
        role="status"
        aria-label="Downloading speech model"
        className="flex items-center gap-1.5"
      >
        <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
          <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
        </span>
        <span className="tabular-nums">{percent}%</span>
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-5 [&_svg]:size-3"
      disabled={disabled}
      title="Dictate (⌘⇧D, hold to talk)"
      aria-label="Dictate"
      onClick={dictation.toggle}
    >
      <Mic />
    </Button>
  );
}
