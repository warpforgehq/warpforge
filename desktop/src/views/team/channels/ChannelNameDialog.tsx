import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { channelNameError } from "@/lib/teamChannels";

interface Props {
  project: string;
  /** The current name when renaming; absent when creating. */
  current?: string;
  /** The project's other channel names. */
  taken: string[];
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => Promise<void>;
}

/** Name a new channel, or rename one. */
export function ChannelNameDialog({ project, current, taken, onOpenChange, onSave }: Props) {
  const [name, setName] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const clean = name.trim().replace(/^#/, "");
    const problem = channelNameError(
      clean,
      taken.filter((t) => t !== current),
    );
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      await onSave(clean);
      onOpenChange(false);
    } catch (cause) {
      toast.error(current ? "Channel not renamed" : "Channel not created", {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>
              {current ? `Rename #${current}` : `New channel in ${project}`}
            </DialogTitle>
            <DialogDescription>
              One lowercase word. Smiths you add to it read its posts with their next prompt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Input
              aria-label="Channel name"
              autoFocus
              placeholder="ci"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {current ? "Rename" : "Create channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
