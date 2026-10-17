import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { daemon } from "@/daemon";
import { useSmiths } from "@/hooks/useSmiths";
import { defaultSmithColor } from "@/lib/smithColors";
import { smithNameError } from "@/lib/smiths";
import { applyName, applyVoice } from "@/lib/soulText";
import { cn } from "@/lib/utils";
import type { Snapshot } from "@/protocol";
import { useSmithsStore } from "@/store/smiths";
import { useUi } from "@/store/ui";

import { HarnessChip } from "../../NewTaskDialog/chips";
import { modelOption } from "../../NewTaskDialog/useTaskCreation";
import { ColorPicker } from "./ColorPicker";
import { IdentityEditor } from "./IdentityEditor";

const DEFAULT_MODEL = "__default__";

export const smithDefaultsKey = ["smithDefaults"] as const;

/** The daemon's templates and presets; they do not change while it runs. */
export function useSmithDefaults() {
  return useQuery({
    queryFn: () => daemon.smithDefaults(),
    queryKey: smithDefaultsKey,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

interface Props {
  snapshot: Snapshot;
  /** The project it starts in: the one the Smiths sidebar shows. */
  project: string | null;
  onClose: () => void;
}

/**
 * New smith in one short step: name, colour, personality, project and agent.
 * The soul and charter are the daemon's real defaults, shown and editable
 * under Customize; everything else starts at its default.
 */
export function NewSmithDialog({ snapshot, project, onClose }: Props) {
  const smiths = useSmiths();
  const defaults = useSmithDefaults();
  const openTeam = useUi((state) => state.openTeam);
  const agents = (snapshot.agents ?? []).filter((agent) => agent.enabled);
  const projects = snapshot.projects.map((p) => p.name);

  const [name, setName] = useState("");
  const [color, setColor] = useState(() => defaultSmithColor(String(Date.now())));
  const [presetId, setPresetId] = useState<string | null>(null);
  const [home, setHome] = useState(project ?? projects[0] ?? "");
  const [agent, setAgent] = useState(agents[0]?.id ?? "claude");
  const [model, setModel] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [editedSoul, setEditedSoul] = useState<string | null>(null);
  const [editedCharter, setEditedCharter] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const presets = defaults.data?.presets ?? [];
  const preset = presets.find((p) => p.id === presetId) ?? presets[0];
  const soul =
    editedSoul ??
    (defaults.data ? applyVoice(applyName(defaults.data.soul, name), preset?.voice ?? "") : "");
  const charter = editedCharter ?? defaults.data?.charter ?? "";
  const models = modelOption(agents.find((a) => a.id === agent)?.models ?? [])?.options ?? [];

  const pickPreset = (id: string) => {
    setPresetId(id);
    const voice = presets.find((p) => p.id === id)?.voice;
    // An edited soul keeps the user's words; only its voice section changes.
    if (editedSoul !== null && voice) setEditedSoul(applyVoice(editedSoul, voice));
  };

  const create = async () => {
    const error = smithNameError(name.trim(), smiths);
    setNameError(error);
    if (error || !home || !defaults.data) return;
    setBusy(true);
    try {
      const detail = await daemon.createSmith({
        accountId: null,
        agent,
        allowedProjects: [home],
        budget: {},
        charter,
        color,
        homeProject: home,
        model,
        name: name.trim(),
        permissions: { createPr: false, push: false, writePaths: [] },
        soul,
      });
      useSmithsStore.getState().upsert(detail.smith);
      openTeam({ id: detail.smith.id, kind: "teammate" });
      onClose();
    } catch (cause) {
      toast.error("Smith not created", {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <DialogHeader>
            <DialogTitle>New smith</DialogTitle>
            <DialogDescription>
              A persistent agent with its own name, memory and rules.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <label className="space-y-1.5">
              <span className="text-[13px] font-medium">Name</span>
              <Input
                aria-label="Name"
                autoFocus
                placeholder="Ada"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError(null);
                }}
              />
              {nameError ? (
                <p role="alert" className="text-xs text-destructive">
                  {nameError}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">One word — you @mention it by name.</p>
              )}
            </label>
            <div className="space-y-1.5">
              <span className="text-[13px] font-medium">Colour</span>
              <ColorPicker value={color} onChange={setColor} name={name || "S"} />
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[13px] font-medium">Personality</span>
            <div role="radiogroup" aria-label="Personality" className="grid grid-cols-2 gap-2">
              {presets.map((candidate) => {
                const active = candidate.id === preset?.id;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => pickPreset(candidate.id)}
                    className={cn(
                      "rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      active ? "border-primary bg-primary/10" : "border-border hover:bg-accent/60",
                    )}
                  >
                    <span className="block text-[13px] font-medium">{candidate.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {candidate.description}
                    </span>
                  </button>
                );
              })}
              {defaults.isLoading && (
                <p className="col-span-2 text-xs text-muted-foreground">Loading personalities…</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-[13px] font-medium">Works in</span>
              <Select value={home} onValueChange={setHome}>
                <SelectTrigger aria-label="Works in" className="h-8">
                  <SelectValue placeholder="Pick a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {candidate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <span className="text-[13px] font-medium">Runs on</span>
              <div className="flex items-center gap-2 text-[13px]">
                <HarnessChip
                  agent={agent}
                  agents={agents}
                  label="Agent"
                  title="The agent this smith runs on"
                  onChange={(next) => {
                    setAgent(next);
                    setModel(null);
                  }}
                />
                <Select
                  value={model ?? DEFAULT_MODEL}
                  onValueChange={(next) => setModel(next === DEFAULT_MODEL ? null : next)}
                >
                  <SelectTrigger aria-label="Model" className="h-8 min-w-0 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_MODEL}>Default model</SelectItem>
                    {models.map((choice) => (
                      <SelectItem key={choice.value} value={choice.value}>
                        {choice.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              aria-expanded={customizing}
              onClick={() => setCustomizing((open) => !open)}
              className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
            >
              <ChevronRight
                aria-hidden
                className={cn("size-3.5 transition-transform", customizing && "rotate-90")}
              />
              Customize soul and charter
            </button>
            {customizing && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  This is the text {name.trim() || "the smith"} starts with. The personality you
                  picked fills in its Voice; change any of it, e.g. add “jokes a lot”.
                </p>
                <IdentityEditor
                  label="Soul"
                  language="markdown"
                  value={soul}
                  onChange={setEditedSoul}
                />
                <IdentityEditor
                  label="Charter"
                  language="yaml"
                  value={charter}
                  onChange={setEditedCharter}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy || !defaults.data || !home}>
              Create {name.trim() || "smith"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
