import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { daemon } from "@/daemon";
import type { Smith, SmithDetail, Snapshot } from "@/protocol";

import { HarnessChip } from "../../NewTaskDialog/chips";
import { modelOption } from "../../NewTaskDialog/useTaskCreation";
import {
  type SmithFormErrors,
  type SmithFormValues,
  smithInputFrom,
  smithPatchFrom,
  validateSmithForm,
} from "./form";
import { IdentityEditor } from "./IdentityEditor";

const DEFAULT = "__default__";

interface Props {
  snapshot: Snapshot;
  /** The Smith being edited; absent for a new teammate. */
  editing?: Smith;
  initial: SmithFormValues;
  /** Every Smith, for the name check. */
  smiths: Smith[];
  onSaved: (detail: SmithDetail) => void;
  onCancel: () => void;
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[13px] font-medium">{label}</div>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** Create or edit a teammate: who it is, where it may work, on what, and its
 *  soul and charter. */
export function SmithForm({ snapshot, editing, initial, smiths, onSaved, onCancel }: Props) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<SmithFormErrors>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof SmithFormValues>(key: K, value: SmithFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const agents = (snapshot.agents ?? []).filter((agent) => agent.enabled);
  const models = modelOption(agents.find((a) => a.id === values.agent)?.models ?? [])?.options;
  const accounts = (snapshot.accounts ?? []).filter((a) => a.agentId === values.agent);
  const projects = snapshot.projects.map((p) => p.name);
  const others = useMemo(() => smiths.filter((s) => s.id !== editing?.id), [editing, smiths]);

  const save = async () => {
    const found = validateSmithForm(values, others);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      if (editing) {
        const patch = smithPatchFrom(values, initial);
        onSaved(
          Object.keys(patch).length > 0
            ? await daemon.updateSmith(editing.id, patch)
            : await daemon.getSmith(editing.id),
        );
      } else {
        onSaved(await daemon.createSmith(smithInputFrom(values)));
      }
    } catch (error) {
      toast.error(editing ? "Smith not saved" : "Smith not created", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      aria-label={editing ? `Edit ${editing.name}` : "New smith"}
      className="min-h-0 flex-1 space-y-5 overflow-y-auto rounded-md border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold">
          {editing ? `Edit ${editing.name}` : "New smith"}
        </h2>
        {!editing && (
          <p className="text-[13px] text-muted-foreground">
            A persistent agent with its own name, memory and rules.
          </p>
        )}
      </div>

      <Field label="Name" error={errors.name} hint="One word — it is how you @mention this smith.">
        <Input
          aria-label="Name"
          value={values.name}
          onChange={(event) => set("name", event.target.value)}
          className="max-w-64"
        />
      </Field>

      <div className="grid gap-5 md:grid-cols-2">
        <Field
          label="Home project"
          error={errors.homeProject}
          hint="Where its conversation lives and whose channel it reads."
        >
          {editing ? (
            <p className="text-[13px]">{values.homeProject}</p>
          ) : (
            <Select value={values.homeProject} onValueChange={(next) => set("homeProject", next)}>
              <SelectTrigger aria-label="Home project" className="h-8 w-56">
                <SelectValue placeholder="Pick a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project} value={project}>
                    {project}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>

        <Field label="Projects it may work in">
          <div role="group" aria-label="Projects it may work in" className="flex flex-wrap gap-3">
            {projects.map((project) => {
              const home = project === values.homeProject;
              return (
                <label key={project} className="flex items-center gap-1.5 text-[13px]">
                  <input
                    type="checkbox"
                    checked={home || values.allowedProjects.includes(project)}
                    disabled={home}
                    onChange={(event) =>
                      set(
                        "allowedProjects",
                        event.target.checked
                          ? [...values.allowedProjects, project]
                          : values.allowedProjects.filter((p) => p !== project),
                      )
                    }
                  />
                  {project}
                </label>
              );
            })}
          </div>
        </Field>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <Field label="Agent" error={errors.agent}>
          <HarnessChip
            agent={values.agent}
            agents={agents}
            label="Agent"
            title="The agent this smith runs on"
            onChange={(next) =>
              setValues((current) => ({ ...current, accountId: null, agent: next, model: null }))
            }
          />
        </Field>
        <Field label="Model">
          <Select
            value={values.model ?? DEFAULT}
            onValueChange={(next) => set("model", next === DEFAULT ? null : next)}
          >
            <SelectTrigger aria-label="Model" className="h-8 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>Agent default</SelectItem>
              {(models ?? []).map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Account" hint="Pinned for its work; otherwise the one selected at the time.">
          <Select
            value={values.accountId ?? DEFAULT}
            onValueChange={(next) => set("accountId", next === DEFAULT ? null : next)}
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
        </Field>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Daily spend limit (USD)" error={errors.usdPerDay} hint="Empty for none.">
          <Input
            aria-label="Daily spend limit"
            inputMode="decimal"
            value={values.usdPerDay}
            onChange={(event) => set("usdPerDay", event.target.value)}
            className="max-w-32"
          />
        </Field>
        <Field label="Daily turn limit" error={errors.turnsPerDay} hint="Empty for none.">
          <Input
            aria-label="Daily turn limit"
            inputMode="numeric"
            value={values.turnsPerDay}
            onChange={(event) => set("turnsPerDay", event.target.value)}
            className="max-w-32"
          />
        </Field>
      </div>

      <Field
        label="Permissions"
        hint="Paths it may change, one per line, relative to the project. Empty means anywhere."
      >
        <Textarea
          aria-label="Paths it may change"
          rows={2}
          value={values.writePaths}
          onChange={(event) => set("writePaths", event.target.value)}
          className="max-w-md font-mono text-xs"
        />
        <div className="flex gap-4 text-[13px]">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={values.push}
              onChange={(event) => set("push", event.target.checked)}
            />
            May push
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={values.createPr}
              onChange={(event) => set("createPr", event.target.checked)}
            />
            May open pull requests
          </label>
        </div>
      </Field>

      <Field
        label="Soul"
        hint="Voice, decision rules and refusals. Warpforge's own rules always come first."
      >
        <IdentityEditor
          label="Soul"
          language="markdown"
          value={values.soul}
          placeholder={editing ? undefined : "Leave empty to start from a template."}
          onChange={(next) => set("soul", next)}
        />
      </Field>

      <Field label="Charter" error={errors.charter} hint="What it watches, in YAML.">
        <IdentityEditor
          label="Charter"
          language="yaml"
          value={values.charter}
          placeholder={editing ? undefined : "Leave empty to start from a template."}
          onChange={(next) => set("charter", next)}
        />
      </Field>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {editing ? "Save" : "Create smith"}
        </Button>
      </div>
    </form>
  );
}
