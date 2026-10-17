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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { daemon } from "@/daemon";
import type { BacklogItem, Smith } from "@/protocol";

const NO_ITEM = "__none__";

interface Props {
  smith: Smith;
  /** The board items assigned to it, offered as the work's item. */
  items: BacklogItem[];
  /** Pre-picked item, when started from one. */
  item?: BacklogItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (taskId: string) => void;
}

/** Start a work session as the teammate: a normal task on the board that runs
 *  with its soul and journal. */
export function StartWorkDialog({ smith, items, item, open, onOpenChange, onStarted }: Props) {
  const [project, setProject] = useState(item?.project ?? smith.homeProject);
  const [brief, setBrief] = useState(item ? `${item.title}\n\n${item.body ?? ""}`.trim() : "");
  const [itemId, setItemId] = useState<string | null>(item?.id ?? null);
  const [busy, setBusy] = useState(false);
  const offered = items.filter((candidate) => candidate.project === project);

  const start = async () => {
    setBusy(true);
    try {
      onStarted(
        await daemon.startSmithWork(smith.id, {
          backlogItemId: itemId,
          brief: brief.trim(),
          project,
        }),
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(`${smith.name} could not start`, {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start work as {smith.name}</DialogTitle>
          <DialogDescription>
            A new task on the board, run by {smith.name} with its soul and what it remembers.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select
            value={project}
            onValueChange={(next) => {
              setProject(next);
              setItemId(null);
            }}
          >
            <SelectTrigger aria-label="Project" className="h-8 w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {smith.allowedProjects.map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {candidate}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            aria-label="Brief"
            rows={5}
            placeholder="What should it do, and what does done look like?"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
          />
          {offered.length > 0 && (
            <Select
              value={itemId ?? NO_ITEM}
              onValueChange={(next) => setItemId(next === NO_ITEM ? null : next)}
            >
              <SelectTrigger aria-label="Board item" className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ITEM}>No board item</SelectItem>
                {offered.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    #{candidate.number} {candidate.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!brief.trim() || busy}
            onClick={() => void start()}
          >
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
