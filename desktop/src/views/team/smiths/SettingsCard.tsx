import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import { useSmiths } from "@/hooks/useSmiths";
import { smithsGuideUrl } from "@/lib/docsLinks";
import { openExternalLink } from "@/lib/externalLinks";
import type { SmithDetail } from "@/protocol";
import { useSmithsStore } from "@/store/smiths";

import {
  type SmithFormErrors,
  type SmithFormValues,
  smithFormFrom,
  smithPatchFrom,
  validateSmithForm,
} from "./form";
import { smithDetailKey } from "./queries";

/**
 * One Settings card's own copy of its fields. A save sends only those fields,
 * read against the latest Smith, so cards never overwrite each other.
 * @param detail the Smith with its identity files
 * @param fields the fields this card edits
 * @returns the values, a setter, whether they changed, the errors and save
 */
export function useCardForm(detail: SmithDetail, fields: (keyof SmithFormValues)[]) {
  const queryClient = useQueryClient();
  const smiths = useSmiths();
  const original = useMemo(() => smithFormFrom(detail), [detail]);
  const [edits, setEdits] = useState<Partial<SmithFormValues>>({});
  const [errors, setErrors] = useState<SmithFormErrors>({});
  const [saving, setSaving] = useState(false);
  const values: SmithFormValues = { ...original };
  for (const field of fields) {
    if (field in edits) (values as unknown as Record<string, unknown>)[field] = edits[field];
  }
  const patch = smithPatchFrom(values, original);
  const dirty = Object.keys(patch).length > 0;

  const set = <K extends keyof SmithFormValues>(key: K, value: SmithFormValues[K]) =>
    setEdits((current) => ({ ...current, [key]: value }));

  const save = async () => {
    const found = validateSmithForm(
      values,
      smiths.filter((s) => s.id !== detail.smith.id),
    );
    setErrors(found);
    if (Object.keys(found).length > 0 || !dirty) return;
    setSaving(true);
    try {
      const next = await daemon.updateSmith(detail.smith.id, patch);
      queryClient.setQueryData(smithDetailKey(next.smith.id), next);
      useSmithsStore.getState().upsert(next.smith);
      setEdits({});
      toast.success("Saved");
    } catch (error) {
      toast.error("Not saved", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  return {
    dirty,
    errors,
    reset: () => setEdits({}),
    save,
    saving,
    set,
    values,
  };
}

/**
 * A titled Settings card: what it changes in plain words, a link to the
 * guide's section, and Save and Revert while it has changes.
 */
export function SettingsCard({
  title,
  description,
  guide,
  form,
  children,
}: {
  title: string;
  description?: string;
  /** The Smiths guide's heading anchor for this setting. */
  guide?: string;
  form?: Pick<ReturnType<typeof useCardForm>, "dirty" | "save" | "saving" | "reset">;
  children?: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          {(description || guide) && (
            <p className="text-xs text-muted-foreground">
              {description}{" "}
              {guide && (
                <button
                  type="button"
                  onClick={() => void openExternalLink(smithsGuideUrl(guide))}
                  className="whitespace-nowrap text-primary underline-offset-2 hover:underline"
                >
                  Learn more
                </button>
              )}
            </p>
          )}
        </div>
        {form?.dirty && (
          <div className="flex shrink-0 gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={form.reset}>
              Revert
            </Button>
            <Button type="button" size="sm" disabled={form.saving} onClick={() => void form.save()}>
              Save
            </Button>
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

/** A field error under its input. */
export function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {error}
    </p>
  );
}
