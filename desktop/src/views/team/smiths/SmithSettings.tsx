import { Loader2, X } from "lucide-react";
import { useId, useState } from "react";

import { ProjectMultiSelect } from "@/components/ProjectMultiSelect";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { injectionNote } from "@/lib/smiths";
import { applyName, applyVoice, voiceOf } from "@/lib/soulText";
import { cn } from "@/lib/utils";
import type { SmithDetail, Snapshot } from "@/protocol";

import { HarnessChip } from "../../NewTaskDialog/chips";
import { modelOption } from "../../NewTaskDialog/useTaskCreation";
import { Toggle as SettingsToggle } from "../../settings/primitives";
import { ColorPicker } from "./ColorPicker";
import { IdentityEditor } from "./IdentityEditor";
import { useSmithDefaults } from "./NewSmithDialog";
import { useSmithDetail } from "./queries";
import { FieldError, SettingsCard, useCardForm } from "./SettingsCard";

const DEFAULT = "__default__";

function IdentityCard({ detail }: { detail: SmithDetail }) {
  const form = useCardForm(detail, ["name", "color"]);
  return (
    <SettingsCard
      title="Identity"
      description="Its name is how you @mention it and how its posts are signed; its colour marks it across the app."
      guide="identity"
      form={form}
    >
      <div className="flex flex-wrap items-start gap-6">
        <label className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Name</span>
          <Input
            aria-label="Name"
            className="w-56"
            value={form.values.name}
            onChange={(event) => form.set("name", event.target.value)}
          />
          <FieldError error={form.errors.name} />
        </label>
        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Colour</span>
          <ColorPicker
            value={form.values.color}
            name={form.values.name}
            onChange={(index) => form.set("color", index)}
          />
        </div>
      </div>
    </SettingsCard>
  );
}

function SoulCard({ detail }: { detail: SmithDetail }) {
  const form = useCardForm(detail, ["soul"]);
  const defaults = useSmithDefaults();
  const voice = voiceOf(form.values.soul);
  return (
    <SettingsCard
      title="Soul"
      description="How it talks and decides. It's given to every session the smith runs, so a change shows from its next session on. Warpforge's own ground rules always come first."
      guide="soul"
      form={form}
    >
      <dl className="grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[auto_1fr]">
        <dt className="font-medium">Voice</dt>
        <dd className="text-muted-foreground">how it writes — tone, length, what it leads with</dd>
        <dt className="font-medium">Decision rules</dt>
        <dd className="text-muted-foreground">
          when it acts on its own, when it asks you, when it waits
        </dd>
        <dt className="font-medium">Refusals</dt>
        <dd className="text-muted-foreground">what it won't do, whoever asks</dd>
      </dl>
      {defaults.data && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Voice:</span>
          {defaults.data.presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={voice === preset.voice}
              title={preset.description}
              onClick={() => form.set("soul", applyVoice(form.values.soul, preset.voice))}
              className={cn(
                "rounded-full border px-2 py-0.5 transition-colors",
                voice === preset.voice
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            className="ml-auto text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() =>
              form.set("soul", applyName(defaults.data.soul, form.values.name || detail.smith.name))
            }
          >
            Restore default
          </button>
        </div>
      )}
      <IdentityEditor
        label="Soul"
        language="markdown"
        value={form.values.soul}
        onChange={(next) => form.set("soul", next)}
      />
    </SettingsCard>
  );
}

function HabitsCard() {
  return (
    <SettingsCard
      title="Habits — coming soon"
      description="Soon a smith will do things on its own, on a schedule or when something happens: for example, check CI every morning and report failures, or review new pull requests when they're opened."
      guide="habits"
    />
  );
}

function ProjectsCard({ detail, snapshot }: { detail: SmithDetail; snapshot: Snapshot }) {
  const form = useCardForm(detail, ["allowedProjects"]);
  const home = form.values.homeProject;
  return (
    <SettingsCard
      title="Projects"
      description="Where it may read, take board items and start work. It follows its home project's #general; in the others it acts only when asked. The home project is set when the smith is created."
      guide="projects"
      form={form}
    >
      <ProjectMultiSelect
        label="Projects it may work in"
        projects={snapshot.projects.map((p) => p.name)}
        value={{ home, projects: [home, ...form.values.allowedProjects.filter((p) => p !== home)] }}
        homeEditable={false}
        onChange={(next) => form.set("allowedProjects", next.projects)}
      />
    </SettingsCard>
  );
}

function ModelCard({ detail, snapshot }: { detail: SmithDetail; snapshot: Snapshot }) {
  const form = useCardForm(detail, ["agent", "model", "accountId"]);
  const agents = (snapshot.agents ?? []).filter((agent) => agent.enabled);
  const models =
    modelOption(agents.find((a) => a.id === form.values.agent)?.models ?? [])?.options ?? [];
  const accounts = (snapshot.accounts ?? []).filter((a) => a.agentId === form.values.agent);
  const note = injectionNote(detail.smith);
  return (
    <SettingsCard
      title="Model & account"
      description="Which agent and model its sessions run on, and the account they use. Takes effect from its next session."
      guide="model-and-account"
      form={form}
    >
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <HarnessChip
          agent={form.values.agent}
          agents={agents}
          label="Agent"
          title="The agent it runs on"
          onChange={(next) => {
            form.set("agent", next);
            form.set("model", null);
            form.set("accountId", null);
          }}
        />
        <Select
          value={form.values.model ?? DEFAULT}
          onValueChange={(next) => form.set("model", next === DEFAULT ? null : next)}
        >
          <SelectTrigger aria-label="Model" className="h-8 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>Default model</SelectItem>
            {models.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={form.values.accountId ?? DEFAULT}
          onValueChange={(next) => form.set("accountId", next === DEFAULT ? null : next)}
        >
          <SelectTrigger aria-label="Account" className="h-8 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>Current account</SelectItem>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </SettingsCard>
  );
}

function LimitsCard({ detail }: { detail: SmithDetail }) {
  const form = useCardForm(detail, ["usdPerDay", "turnsPerDay"]);
  return (
    <SettingsCard
      title="Limits"
      description="Caps on what it does on its own each day. Past either, it starts no new work until the next day; work you start for it still runs. Empty means no limit."
      guide="limits"
      form={form}
    >
      <div className="flex flex-wrap gap-6 text-[13px]">
        <label className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Spend per day (USD)</span>
          <Input
            aria-label="Spend per day"
            inputMode="decimal"
            className="w-32"
            value={form.values.usdPerDay}
            onChange={(event) => form.set("usdPerDay", event.target.value)}
          />
          <FieldError error={form.errors.usdPerDay} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Turns per day</span>
          <Input
            aria-label="Turns per day"
            inputMode="numeric"
            className="w-32"
            value={form.values.turnsPerDay}
            onChange={(event) => form.set("turnsPerDay", event.target.value)}
          />
          <FieldError error={form.errors.turnsPerDay} />
        </label>
      </div>
    </SettingsCard>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <span className="flex items-center gap-2 text-[13px]">
      <SettingsToggle id={id} checked={checked} onChange={onChange} />
      <label htmlFor={id} className="cursor-pointer">
        {label}
      </label>
    </span>
  );
}

function PermissionsCard({ detail }: { detail: SmithDetail }) {
  const form = useCardForm(detail, ["writePaths", "push", "createPr"]);
  const [draft, setDraft] = useState("");
  const paths = form.values.writePaths.split("\n").filter(Boolean);
  const setPaths = (next: string[]) => form.set("writePaths", next.join("\n"));
  const add = () => {
    const path = draft.trim();
    if (path && !paths.includes(path)) setPaths([...paths, path]);
    setDraft("");
  };
  return (
    <SettingsCard
      title="Permissions"
      description="What its work sessions may change: which paths, and whether they may push or open pull requests. Reading is always allowed."
      guide="permissions"
      form={form}
    >
      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">
          Paths it may change {paths.length === 0 && "— anywhere in the project"}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {paths.map((path) => (
            <span
              key={path}
              className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-xs"
            >
              {path}
              <button
                type="button"
                aria-label={`Remove ${path}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setPaths(paths.filter((p) => p !== path))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Input
            aria-label="Add a path"
            placeholder="src/ — Enter to add"
            className="h-7 w-48 font-mono text-xs"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-6">
        <Toggle label="May push" checked={form.values.push} onChange={(v) => form.set("push", v)} />
        <Toggle
          label="May open pull requests"
          checked={form.values.createPr}
          onChange={(v) => form.set("createPr", v)}
        />
      </div>
    </SettingsCard>
  );
}

/** The Smith page's Settings tab: one card per concern, each saved alone. */
export function SmithSettings({ smithId, snapshot }: { smithId: string; snapshot: Snapshot }) {
  const detail = useSmithDetail(smithId);
  if (!detail.data) {
    return (
      <div className="flex items-center gap-2 p-4 text-[13px] text-muted-foreground">
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
        Loading settings…
      </div>
    );
  }
  return (
    <div className="grid gap-3 pb-4 xl:grid-cols-2">
      <IdentityCard detail={detail.data} />
      <ModelCard detail={detail.data} snapshot={snapshot} />
      <div className="xl:col-span-2">
        <SoulCard detail={detail.data} />
      </div>
      <ProjectsCard detail={detail.data} snapshot={snapshot} />
      <LimitsCard detail={detail.data} />
      <PermissionsCard detail={detail.data} />
      <HabitsCard />
    </div>
  );
}
