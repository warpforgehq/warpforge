import { Layers } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { daemon } from "@/daemon";
import { cn } from "@/lib/utils";
import { pinNewSpace } from "@/store/pins";
import { settingsControl } from "@/views/settings/primitives";

import { moveProjectToSpace, useAddToSpace } from "./addToSpace";

const NEW = "__new__";

/** Put a project into an existing space or a new one. */
export function AddToSpaceDialog() {
  const project = useAddToSpace((s) => s.project);
  const close = useAddToSpace((s) => s.close);
  const newSpace = useAddToSpace((s) => s.newSpace);
  const { snapshot } = useSyncExternalStore(daemon.subscribe, daemon.getState);
  const spaces = snapshot.spaces ?? [];
  const [choice, setChoice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = choice ?? (newSpace ? NEW : (spaces[0]?.id ?? NEW));

  const reset = () => {
    setChoice(null);
    setName("");
    setError(null);
    close();
  };

  const submit = async () => {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      let id = target;
      if (target === NEW) {
        id = (await daemon.createSpace(name.trim())).id;
        pinNewSpace(id);
      }
      await moveProjectToSpace(project, id, spaces);
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={project !== null} onOpenChange={(open) => !open && reset()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add {project} to a space</DialogTitle>
          <DialogDescription>
            Agents on new tasks in a space can see its other repositories.
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Space" className="flex flex-col gap-1">
          {spaces.map((space) => (
            <button
              key={space.id}
              type="button"
              role="radio"
              aria-checked={target === space.id}
              onClick={() => setChoice(space.id)}
              className={cn(
                "flex h-8 items-center gap-2 rounded-control px-2.5 text-left text-[0.8125rem] transition-colors",
                target === space.id ? "bg-accent/60 text-foreground" : "hover:bg-accent/40",
              )}
            >
              <Layers aria-hidden className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{space.name}</span>
              <span className="text-[0.75rem] text-muted-foreground">
                {space.members.length} members
              </span>
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={target === NEW}
            onClick={() => setChoice(NEW)}
            className={cn(
              "flex h-8 items-center gap-2 rounded-control px-2.5 text-left text-[0.8125rem] transition-colors",
              target === NEW ? "bg-accent/60 text-foreground" : "hover:bg-accent/40",
            )}
          >
            New space…
          </button>
          {target === NEW && (
            <input
              aria-label="New space name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Space name"
              className={`${settingsControl} mt-1 w-full`}
            />
          )}
        </div>
        {error && (
          <p role="alert" className="text-[0.75rem] text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={reset}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || (target === NEW && !name.trim())}
            onClick={() => void submit()}
          >
            Add to space
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
