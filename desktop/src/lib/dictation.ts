/** Speech model as listed by the desktop shell. */
export interface DictationModel {
  id: string;
  label: string;
  description: string;
  sizeBytes: number;
  installed: boolean;
  isDefault: boolean;
}

export interface DictationProgress {
  id: string;
  downloaded: number;
  total: number;
}

export interface DictationLevel {
  level: number;
  elapsedMs: number;
}

export const DEFAULT_DICTATION_MODEL = "large-v3-turbo-q5_0";
export const DEFAULT_DICTATION_MODEL_BYTES = 574_041_195;
export const MAX_RECORDING_MS = 5 * 60 * 1000;

/** Whisper language codes offered in Settings, the three primary ones first. */
export const DICTATION_LANGUAGES: { code: string; label: string }[] = [
  { code: "auto", label: "Auto-detect" },
  { code: "uk", label: "Ukrainian" },
  { code: "ru", label: "Russian" },
  { code: "en", label: "English" },
  ...(
    [
      ["ar", "Arabic"],
      ["cs", "Czech"],
      ["da", "Danish"],
      ["de", "German"],
      ["el", "Greek"],
      ["es", "Spanish"],
      ["fi", "Finnish"],
      ["fr", "French"],
      ["he", "Hebrew"],
      ["hi", "Hindi"],
      ["hu", "Hungarian"],
      ["it", "Italian"],
      ["ja", "Japanese"],
      ["ka", "Georgian"],
      ["kk", "Kazakh"],
      ["ko", "Korean"],
      ["lt", "Lithuanian"],
      ["lv", "Latvian"],
      ["nl", "Dutch"],
      ["no", "Norwegian"],
      ["pl", "Polish"],
      ["pt", "Portuguese"],
      ["ro", "Romanian"],
      ["sk", "Slovak"],
      ["sv", "Swedish"],
      ["tr", "Turkish"],
      ["vi", "Vietnamese"],
      ["zh", "Chinese"],
    ] as const
  ).map(([code, label]) => ({ code, label })),
];

export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktopShell()) throw new Error("Voice input is only available in the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

let eventApi: Promise<typeof import("@tauri-apps/api/event")> | undefined;

/** Subscribe to a shell event; returns the unsubscribe function. */
async function on<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!isDesktopShell()) return () => {};
  eventApi ??= import("@tauri-apps/api/event");
  const { listen } = await eventApi;
  return listen<T>(event, (e) => handler(e.payload));
}

export const dictation = {
  models: () => call<DictationModel[]>("dictation_models"),
  devices: () => call<string[]>("dictation_devices"),
  start: (device: string | null) => call<void>("dictation_start", { device }),
  stop: (opts: { model: string; language: string; customWords: string }) =>
    call<string>("dictation_stop", opts),
  cancel: () => call<void>("dictation_cancel"),
  download: (id: string) => call<void>("dictation_download", { id }),
  deleteModel: (id: string) => call<void>("dictation_delete_model", { id }),
  onLevel: (handler: (level: DictationLevel) => void) => on("dictation:level", handler),
  onLimit: (handler: () => void) => on<null>("dictation:limit", () => handler()),
  onProgress: (handler: (progress: DictationProgress) => void) => on("dictation:progress", handler),
};

/** The model to record with: the chosen one if installed, else any installed one. */
export function pickInstalledModel(models: DictationModel[], chosen: string): string | null {
  const installed = models.filter((m) => m.installed);
  return (installed.find((m) => m.id === chosen) ?? installed[0])?.id ?? null;
}

/**
 * Insert dictated text over the selection, adding a space on either side
 * only where the surrounding text needs one.
 */
export function insertTranscript(
  value: string,
  start: number,
  end: number,
  text: string,
): { value: string; caret: number } {
  const spoken = text.trim();
  if (!spoken) return { value, caret: end };
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^[\s.,!?;:)\]]/.test(after) ? " " : "";
  const inserted = `${lead}${spoken}${trail}`;
  return { value: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}
