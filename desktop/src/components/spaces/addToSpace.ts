import { create } from "zustand";

/** The project the Add to space dialog is open for. Transient. */
export const useAddToSpace = create<{
  project: string | null;
  open: (project: string) => void;
  close: () => void;
}>()((set) => ({
  project: null,
  open: (project) => set({ project }),
  close: () => set({ project: null }),
}));
