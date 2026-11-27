import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_DICTATION_MODEL } from "@/lib/dictation";

interface VoiceState {
  /** Catalog id of the speech model to transcribe with. */
  model: string;
  /** Whisper language code, or "auto". */
  language: string;
  /** Words and names to spell exactly, comma or newline separated. */
  customWords: string;
  /** Input device name; null follows the system default. */
  device: string | null;
  setModel: (model: string) => void;
  setLanguage: (language: string) => void;
  setCustomWords: (words: string) => void;
  setDevice: (device: string | null) => void;
}

export const useVoice = create<VoiceState>()(
  persist(
    (set) => ({
      model: DEFAULT_DICTATION_MODEL,
      language: "auto",
      customWords: "",
      device: null,
      setModel: (model) => set({ model }),
      setLanguage: (language) => set({ language }),
      setCustomWords: (customWords) => set({ customWords }),
      setDevice: (device) => set({ device }),
    }),
    { name: "wf-voice", version: 1 },
  ),
);
