import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import { pinNewSpace } from "@/store/pins";
import { spaceProjectNames } from "@/store/ui";

import { settingsControl, SettingsPage, SettingsSection } from "../primitives";
import { SpaceSection } from "./spaces/SpaceSection";

/** Settings → Spaces & repos: group projects and folders into spaces. */
export default function SpacesPage() {
  const { snapshot } = useSyncExternalStore(daemon.subscribe, daemon.getState);
  const spaces = snapshot.spaces ?? [];
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const taken = new Set(spaces.flatMap(spaceProjectNames));
  const freeProjects = snapshot.projects
    .map((project) => project.name)
    .filter((project) => !taken.has(project));

  const create = async () => {
    setError(null);
    try {
      pinNewSpace((await daemon.createSpace(name.trim())).id);
      setName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <SettingsPage page="spaces">
      <SettingsSection id="spaces" title="New space">
        <form
          className="flex items-center gap-2 px-3.5 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            aria-label="Space name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Payments"
            className={`${settingsControl} flex-1`}
          />
          <Button type="submit" size="sm" variant="outline" disabled={!name.trim()}>
            Create space
          </Button>
        </form>
        {error && (
          <p role="alert" className="px-3.5 py-2.5 text-[0.75rem] text-destructive">
            {error}
          </p>
        )}
      </SettingsSection>
      <div id="space-members" tabIndex={-1}>
        {spaces.map((space) => (
          <SpaceSection
            key={space.id}
            space={space}
            projects={snapshot.projects}
            freeProjects={freeProjects}
          />
        ))}
      </div>
      <p className="mt-6 px-1 text-[0.75rem] leading-relaxed text-muted-foreground">
        A project belongs to one space. New tasks in it can see the space's other repositories;
        tasks already running keep the folders they started with. For now, other repositories are
        edited in their main checkout, not a task worktree, and their changes don't show in the
        Changes rail. A repo can also list its siblings under <code>linked:</code> in its
        workspace.yaml.
      </p>
    </SettingsPage>
  );
}
