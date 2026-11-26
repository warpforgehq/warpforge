import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  dictation,
  DICTATION_LANGUAGES,
  type DictationModel,
  formatBytes,
  isDesktopShell,
} from "@/lib/dictation";
import { useVoice } from "@/store/voice";

import { Section, SectionNote, SettingRow } from "../primitives";

const SELECT_CLASS =
  "bg-deep-surface h-7 max-w-[220px] rounded-md border px-2 text-[13px] outline-none focus:ring-1 focus:ring-ring";
const MODELS_KEY = ["dictation", "models"];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ModelControl({
  model,
  active,
  progress,
  onDownload,
}: {
  model: DictationModel;
  active: boolean;
  progress: number | undefined;
  onDownload: () => void;
}) {
  const queryClient = useQueryClient();
  const setModel = useVoice((s) => s.setModel);
  const refresh = () => queryClient.invalidateQueries({ queryKey: MODELS_KEY });

  const remove = async () => {
    try {
      await dictation.deleteModel(model.id);
    } catch (error) {
      toast.error(message(error));
    }
    await refresh();
  };

  if (progress !== undefined) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[13px] tabular-nums text-muted-foreground">{progress}%</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => void remove()}>
          Cancel
        </Button>
      </div>
    );
  }
  if (!model.installed) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={onDownload}>
        Download
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {active ? (
        <span className="text-[13px] text-muted-foreground">In use</span>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setModel(model.id)}>
          Use
        </Button>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={() => void remove()}>
        Delete
      </Button>
    </div>
  );
}

export default function VoicePage() {
  const queryClient = useQueryClient();
  const desktop = isDesktopShell();
  const voice = useVoice();
  const [progress, setProgress] = useState<Record<string, number>>({});

  const models = useQuery({ queryKey: MODELS_KEY, queryFn: dictation.models, enabled: desktop });
  const devices = useQuery({
    queryKey: ["dictation", "devices"],
    queryFn: dictation.devices,
    enabled: desktop,
  });

  useEffect(() => {
    let unlisten = () => {};
    let live = true;
    void dictation
      .onProgress(({ id, downloaded, total }) => {
        const percent = total ? Math.floor((downloaded / total) * 100) : 0;
        setProgress((prev) => ({ ...prev, [id]: percent }));
      })
      .then((fn) => {
        if (live) unlisten = fn;
        else fn();
      });
    return () => {
      live = false;
      unlisten();
    };
  }, []);

  const download = async (id: string) => {
    setProgress((prev) => ({ ...prev, [id]: 0 }));
    try {
      await dictation.download(id);
      if (!models.data?.some((m) => m.installed)) voice.setModel(id);
    } catch (error) {
      toast.error(message(error));
    } finally {
      setProgress(({ [id]: _, ...rest }) => rest);
      await queryClient.invalidateQueries({ queryKey: MODELS_KEY });
    }
  };

  const installed = models.data?.filter((m) => m.installed) ?? [];
  const activeModel =
    installed.find((m) => m.id === voice.model)?.id ?? installed[0]?.id ?? voice.model;

  return (
    <div className="flex flex-col gap-8">
      {!desktop && (
        <SectionNote>Voice input is available in the Warpforge desktop app.</SectionNote>
      )}
      <Section title="Speech model">
        {(models.data ?? []).map((model) => (
          <SettingRow
            key={model.id}
            title={`${model.label} · ${formatBytes(model.sizeBytes)}`}
            description={model.description}
            hint="Downloaded once to ~/.warpforge/models. Speech is transcribed on this Mac and never uploaded."
            control={
              <ModelControl
                model={model}
                active={model.installed && model.id === activeModel}
                progress={progress[model.id]}
                onDownload={() => void download(model.id)}
              />
            }
          />
        ))}
        {models.isError && <SectionNote>{message(models.error)}</SectionNote>}
      </Section>

      <Section title="Recognition">
        <SettingRow
          title="Language"
          description="What you speak. Auto-detect handles mixed languages."
          hint="Pick a language when short phrases come out in the wrong one."
          control={
            <select
              value={voice.language}
              onChange={(e) => voice.setLanguage(e.target.value)}
              className={SELECT_CLASS}
              aria-label="Dictation language"
            >
              {DICTATION_LANGUAGES.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          }
        />
        <div className="space-y-2 border-t border-rule px-4 py-3">
          <div className="space-y-0.5">
            <h3 className="text-[13px] font-semibold text-foreground">Custom words</h3>
            <p className="text-[13px] text-muted-foreground/80">
              Names and terms to spell exactly, separated by commas or new lines.
            </p>
          </div>
          <textarea
            value={voice.customWords}
            onChange={(e) => voice.setCustomWords(e.target.value)}
            rows={3}
            placeholder="Warpforge, worktree, pull request, Tauri"
            aria-label="Custom words"
            className="bg-deep-surface w-full resize-y rounded-md border px-2 py-1.5 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </Section>

      <Section title="Microphone">
        <SettingRow
          title="Input device"
          description="The microphone voice input records from."
          control={
            <select
              value={voice.device ?? ""}
              onChange={(e) => voice.setDevice(e.target.value || null)}
              className={SELECT_CLASS}
              aria-label="Microphone"
            >
              <option value="">System default</option>
              {(devices.data ?? []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          }
        />
      </Section>
    </div>
  );
}
