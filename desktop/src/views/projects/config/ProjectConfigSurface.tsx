import { FileCode2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { sharedSecretKeys } from "@/lib/projectConfig/view";
import { requestProjectFile } from "@/lib/projectFileNav";
import type { ServiceInfo } from "@/protocol";
import { useUi } from "@/store/ui";

import { ConflictList } from "./ConflictList";
import { ForwardsSection } from "./ForwardsSection";
import { LinkedSection, PortsSection, WorktreeSection } from "./MoreSections";
import { ServicesSection } from "./ServicesSection";
import { useProjectConfig } from "./useProjectConfig";

interface Props {
  project: string;
  rootPath: string;
  /** The project's services as the runtime reports them, for restart badges. */
  services: ServiceInfo[];
}

function relativePath(rootPath: string, path: string): string {
  const root = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  return path.startsWith(root) ? path.slice(root.length) : path;
}

function Banner({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-[0.75rem] text-foreground"
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {action}
    </div>
  );
}

const location = (line?: number, column?: number) =>
  line ? `${line}${column ? `:${column}` : ""}` : null;

/**
 * The Config section: a form over the project's config file and the
 * personal overlay, saved through the daemon.
 */
export function ProjectConfigSurface({ project, rootPath, services }: Props) {
  const form = useProjectConfig(project);
  const [secrets, setSecrets] = useState<string[]>([]);
  const data = useMemo(
    () => ({ local: form.docs?.local.toJS(), shared: form.docs?.shared.toJS() }),
    [form.docs],
  );

  const openFile = (path: string) => {
    requestProjectFile({ path: relativePath(rootPath, path), project });
    useUi.getState().openProject(project, "files");
  };

  if (!form.read || !form.view) {
    return (
      <p className="px-6 pt-6 text-[0.8125rem] text-muted-foreground">
        {form.loadError ?? "Loading config…"}
      </p>
    );
  }

  const { read, view, readOnly, edit } = form;
  const save = () => {
    const keys = sharedSecretKeys(form.ops);
    if (keys.length > 0) setSecrets(keys);
    else void form.save();
  };
  const common = { edit, readOnly, view };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[640px] px-6 pb-16 pt-6">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[1.25rem] font-medium tracking-tight text-foreground">
              {view.name}
            </h1>
            <p
              className="mt-1 truncate font-mono text-[0.75rem] text-muted-foreground"
              title={read.shared.path}
            >
              {relativePath(rootPath, read.shared.path)}
              {read.local.exists && ` + ${relativePath(rootPath, read.local.path)}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {form.dirty && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={form.discard}
                disabled={form.saving}
              >
                Discard
              </Button>
            )}
            {form.dirty && (
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={form.saving || form.conflicts.length > 0}
              >
                {form.saving ? "Saving…" : "Save"}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              disabled={!read.shared.exists}
              onClick={() => openFile(read.shared.path)}
            >
              <FileCode2 className="size-3.5" />
              Open file
            </Button>
          </div>
        </header>

        {read.configError && (
          <Banner action={<OpenButton onClick={() => openFile(read.configError!.file)} />}>
            <span className="font-mono">
              {relativePath(rootPath, read.configError.file)}
              {location(read.configError.line, read.configError.column) &&
                `:${location(read.configError.line, read.configError.column)}`}
            </span>{" "}
            does not parse, so this page is read-only until it does. {read.configError.message}
          </Banner>
        )}
        {read.localConfigError && (
          <Banner action={<OpenButton onClick={() => openFile(read.local.path)} />}>
            <span className="font-mono">{relativePath(rootPath, read.local.path)}</span> has an
            error and is being ignored, so this page is read-only. {read.localConfigError}
          </Banner>
        )}
        {!read.configError && !read.localConfigError && form.parseError && (
          <Banner>The config does not parse, so this page is read-only. {form.parseError}</Banner>
        )}
        {form.saveError && (
          <Banner>
            Not saved
            {location(form.saveError.line, form.saveError.column) &&
              ` (line ${location(form.saveError.line, form.saveError.column)})`}
            : {form.saveError.message}
          </Banner>
        )}
        {!read.shared.exists && (
          <p className="mt-4 px-1 text-[0.75rem] text-muted-foreground">
            This project has no config file yet. Saving creates it.
          </p>
        )}

        <ConflictList conflicts={form.conflicts} onResolve={form.resolve} />

        <ServicesSection project={project} runtime={services} {...common} />
        <ForwardsSection data={data} {...common} />
        <PortsSection {...common} />
        <WorktreeSection {...common} />
        <LinkedSection linked={view.linked} />
        <p className="mt-6 px-1 text-[0.75rem] leading-relaxed text-muted-foreground">
          Shared values are saved to the config file and committed with the project. Only me values
          stay on this machine and override the shared ones. Saving does not restart services.
        </p>
      </div>

      <ConfirmDialog
        open={secrets.length > 0}
        title="Save secrets to the shared file?"
        description={`${secrets.join(", ")} will be written to the shared config and committed to git with the project. Switch ${secrets.length > 1 ? "them" : "it"} to Only me to keep ${secrets.length > 1 ? "them" : "it"} on this machine.`}
        confirmLabel="Save to shared"
        onCancel={() => setSecrets([])}
        onConfirm={async () => {
          setSecrets([]);
          await form.save();
        }}
      />
    </div>
  );
}

function OpenButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-6 shrink-0 text-[0.75rem]"
      onClick={onClick}
    >
      Open file
    </Button>
  );
}
