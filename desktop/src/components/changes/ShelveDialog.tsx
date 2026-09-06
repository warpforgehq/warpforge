import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useUi } from "@/store/ui";

import { daemon } from "../../daemon";
import { reportGitFailure } from "./reportGitFailure";

/**
 * "Shelve…" / "Stash…" dialog: name the bundle (or leave it blank for an
 * automatic name), optionally draft the name from the diff with the
 * text-generation agent — the same magic button the commit box and the PR
 * dialog have. Shelving stores a Warpforge-owned bundle outside the repo;
 * stashing uses git-native `git stash push` (shared across worktrees).
 */
export function ShelveDialog({
  mode,
  paths,
  taskId,
  onClose,
  onShelved,
}: {
  mode: "shelf" | "stash";
  /** Null hides the dialog. Otherwise, the paths being shelved/stashed. */
  paths: string[] | null;
  taskId: string;
  onClose: () => void;
  onShelved: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const textGenAgentId = useUi((s) => s.textGenAgentId);
  const textGenModel = useUi((s) => s.textGenModel);

  if (!paths) {
    return null;
  }
  const verb = mode === "shelf" ? "Shelve" : "Stash";
  const noun = mode === "shelf" ? "shelf name" : "stash message";

  const generateName = async () => {
    if (!textGenAgentId || generating) {
      return;
    }
    setGenerating(true);
    try {
      const text = await daemon.generateText(
        taskId,
        textGenAgentId,
        "shelf_name",
        textGenModel ?? undefined,
        { input: paths.join("\n") },
      );
      setName(text.split("\n")[0].trim());
    } catch (e) {
      reportGitFailure(`Could not draft a ${noun}`, e);
    } finally {
      setGenerating(false);
    }
  };

  const submit = async () => {
    if (busy || paths.length === 0) {
      return;
    }
    setBusy(true);
    try {
      if (mode === "shelf") {
        await daemon.request("shelf.create", {
          name: name.trim(),
          paths,
          task_id: taskId,
        });
      } else {
        await daemon.request("stash.push", {
          message: name.trim(),
          paths,
          task_id: taskId,
        });
      }
      setName("");
      onShelved();
    } catch (e) {
      reportGitFailure(`Could not ${verb.toLowerCase()} the selected changes`, e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-label={`${verb} changes`}>
        <DialogHeader>
          <DialogTitle>
            {verb} {paths.length} file{paths.length === 1 ? "" : "s"}
          </DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Input
            autoFocus
            aria-label={noun === "shelf name" ? "Shelf name" : "Stash message"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void submit();
              }
            }}
            placeholder={
              mode === "shelf" ? "Shelf name (blank for an automatic one)" : "Stash message (blank for git default)"
            }
            className="pr-9"
          />
          <button
            type="button"
            className="absolute bottom-1/2 right-1.5 translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            disabled={generating || busy || !textGenAgentId}
            aria-label={`Draft ${noun}`}
            title={
              textGenAgentId
                ? `Draft a ${noun} from the diff`
                : "Pick a text-generation agent in Settings first"
            }
            onClick={() => void generateName()}
          >
            {generating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
          </button>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || paths.length === 0} onClick={() => void submit()}>
            {busy ? (mode === "shelf" ? "Shelving…" : "Stashing…") : verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
