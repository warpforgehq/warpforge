import { FolderOpen } from "lucide-react";
import { toast } from "sonner";

import { useChatFolder } from "@/hooks/useChatFolder";

/**
 * Shows a chat's folder in Finder; in a chat it takes the git controls' place.
 * @param props.taskId The chat.
 * @returns The button, or nothing outside the desktop app.
 */
export function ChatFolderButton({ taskId }: { taskId: string }) {
  const folder = useChatFolder(taskId);
  if (!("__TAURI_INTERNALS__" in window)) return null;
  const reveal = async () => {
    if (!folder) return;
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(folder.path);
    } catch (error) {
      toast.error("Could not open the chat folder", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return (
    <button
      type="button"
      disabled={!folder}
      title={folder?.path}
      onClick={() => void reveal()}
      className="flex h-5 items-center gap-1 rounded px-1.5 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
    >
      <FolderOpen aria-hidden className="size-3" />
      Open folder
    </button>
  );
}
