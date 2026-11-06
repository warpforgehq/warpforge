import { Plus } from "lucide-react";
import { Fragment } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type KeeperPresetId, missingPresets } from "@/lib/keepers";
import type { KeeperEntry } from "@/protocol";

const GROUPS = [
  { label: "On every commit", when: "commit" },
  { label: "Before the pull request", when: "ready" },
] as const;

/**
 * **Add keeper**: the built-ins the project has no file for, grouped by when
 * they run.
 * @param entries The project's keeper files.
 * @param onAdd Writes the picked preset.
 * @returns The menu, or nothing when every preset is taken.
 */
export function AddKeeper({
  entries,
  onAdd,
}: {
  entries: readonly KeeperEntry[];
  onAdd: (preset: KeeperPresetId) => void;
}) {
  const presets = missingPresets(entries);
  if (presets.length === 0) return null;
  const groups = GROUPS.map((group) => ({
    ...group,
    presets: presets.filter((preset) => preset.when === group.when),
  })).filter((group) => group.presets.length > 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus aria-hidden />
          Add keeper
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 text-left">
        {groups.map((group, index) => (
          <Fragment key={group.when}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="font-medium text-muted-foreground">
              {group.label}
            </DropdownMenuLabel>
            {group.presets.map((preset) => (
              <DropdownMenuItem
                key={preset.id}
                className="items-start py-1.5"
                onSelect={() => onAdd(preset.id)}
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium">{preset.name}</span>
                  <span className="text-xs text-muted-foreground">{preset.hint}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
