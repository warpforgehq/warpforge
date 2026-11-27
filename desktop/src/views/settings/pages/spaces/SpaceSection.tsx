import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Folder, FolderGit2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import { IS_TAURI } from "@/lib/platform";
import type { ProjectInfo, Space, SpaceMember } from "@/protocol";

import { SettingsBadge, settingsControl, SettingsRow, SettingsSection } from "../../primitives";
import { linkedBy } from "./linked";

interface Props {
  space: Space;
  projects: readonly ProjectInfo[];
  /** Projects in no space, which this one may take. */
  freeProjects: readonly string[];
}

const folderName = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

/** One space on the Spaces & repos page: its members and how to change them. */
export function SpaceSection({ space, projects, freeProjects }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [project, setProject] = useState("");
  const [folder, setFolder] = useState("");

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };

  const addMember = (member: SpaceMember) => run(() => daemon.addSpaceMember(space.id, member));

  const addFolder = async (path: string) => {
    if (!path.trim()) return;
    if (await addMember({ kind: "folder", name: folderName(path), path: path.trim() })) {
      setFolder("");
    }
  };

  const browse = async () => {
    const picked = await openDialog({ directory: true, multiple: false, title: "Add a folder" });
    if (typeof picked === "string") await addFolder(picked);
  };

  const pickedProject = freeProjects.includes(project) ? project : (freeProjects[0] ?? "");

  return (
    <SettingsSection
      title={space.name}
      actions={
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-[0.75rem] text-muted-foreground"
            onClick={() => setRenaming(space.name)}
          >
            Rename
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-[0.75rem] text-muted-foreground"
            onClick={() => setDeleting(true)}
          >
            Delete
          </Button>
        </div>
      }
    >
      {renaming !== null && (
        <form
          className="flex items-center gap-2 px-3.5 py-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await run(() => daemon.renameSpace(space.id, renaming.trim()))) setRenaming(null);
          }}
        >
          <input
            aria-label={`New name for ${space.name}`}
            value={renaming}
            onChange={(event) => setRenaming(event.target.value)}
            className={`${settingsControl} flex-1`}
          />
          <Button type="submit" size="sm" variant="outline" disabled={!renaming.trim()}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
            Cancel
          </Button>
        </form>
      )}
      {space.members.map((member) => {
        const declaredIn = linkedBy(space, member, projects);
        const path =
          member.kind === "folder"
            ? member.path
            : projects.find((candidate) => candidate.name === member.name)?.path;
        return (
          <SettingsRow
            key={member.kind === "folder" ? `folder:${member.path}` : `project:${member.name}`}
            icon={
              member.kind === "project" ? (
                <FolderGit2 className="size-4 text-muted-foreground" />
              ) : (
                <Folder className="size-4 text-muted-foreground" />
              )
            }
            title={member.name}
            meta={
              declaredIn ? (
                <SettingsBadge>from workspace.yaml</SettingsBadge>
              ) : member.kind === "folder" ? (
                <SettingsBadge>folder</SettingsBadge>
              ) : undefined
            }
            description={
              <>
                {path && <span className="block truncate font-mono">{path}</span>}
                {declaredIn && (
                  <span className="block">
                    Listed under <span className="font-mono">linked:</span> in {declaredIn}'s
                    workspace.yaml. Removing it here comes back while it is still listed there.
                  </span>
                )}
              </>
            }
            control={
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                aria-label={`Remove ${member.name} from ${space.name}`}
                onClick={() =>
                  void run(() =>
                    daemon.removeSpaceMember(
                      space.id,
                      member.kind === "folder"
                        ? { kind: "folder", path: member.path }
                        : { kind: "project", name: member.name },
                    ),
                  )
                }
              >
                Remove
              </Button>
            }
          />
        );
      })}
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
        <select
          aria-label={`Project to add to ${space.name}`}
          value={pickedProject}
          disabled={freeProjects.length === 0}
          onChange={(event) => setProject(event.target.value)}
          className={`${settingsControl} min-w-40 flex-1`}
        >
          {freeProjects.length === 0 && <option value="">Every project is in a space</option>}
          {freeProjects.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!pickedProject}
          onClick={() => void addMember({ kind: "project", name: pickedProject })}
        >
          Add project
        </Button>
        {IS_TAURI ? (
          <Button type="button" size="sm" variant="outline" onClick={() => void browse()}>
            Add folder…
          </Button>
        ) : (
          <form
            className="flex w-full items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void addFolder(folder);
            }}
          >
            <input
              aria-label={`Folder path to add to ${space.name}`}
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              placeholder="/absolute/path/to/folder"
              className={`${settingsControl} flex-1 font-mono`}
            />
            <Button type="submit" size="sm" variant="outline" disabled={!folder.trim()}>
              Add folder
            </Button>
          </form>
        )}
      </div>
      {error && (
        <p role="alert" className="px-3.5 py-2.5 text-[0.75rem] text-destructive">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={deleting}
        title={`Delete ${space.name}?`}
        description="Its projects and folders stay registered and untouched. New tasks in them stop seeing each other."
        confirmLabel="Delete space"
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          await run(() => daemon.deleteSpace(space.id));
          setDeleting(false);
        }}
      />
    </SettingsSection>
  );
}
