import { ChevronDown, GitPullRequestArrow, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { GitPushInfo } from "../../protocol";
import type { RepositoryOperation } from "../../store/ui";

interface PushFooterProps {
  info: GitPushInfo | null;
  loading: boolean;
  pushing: "push" | "force" | null;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  repositoryOperation: RepositoryOperation | null;
  onCreatePr: () => void;
  createPrDisabledReason?: string;
  onPush: (force: boolean) => void;
}

export function PushFooter({
  info,
  loading,
  pushing,
  menuOpen,
  onMenuOpenChange,
  repositoryOperation,
  onCreatePr,
  createPrDisabledReason,
  onPush,
}: PushFooterProps) {
  return (
    <footer className="flex shrink-0 flex-col gap-2 border-t p-2">
      <div className="min-w-0 text-[11px] text-muted-foreground">
        {info && !info.hasUpstream && info.commits.length > 0 && (
          <span>
            First push will create upstream{" "}
            <span className="font-mono text-foreground">{info.upstream}</span>.
          </span>
        )}
        {info?.hasUpstream && info.commits.length > 0 && (
          <span>
            {info.commits.length} outgoing {info.commits.length === 1 ? "commit" : "commits"}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          type="button"
          variant="secondary"
          className="text-[13px]"
          disabled={!info || loading || Boolean(pushing) || Boolean(createPrDisabledReason)}
          onClick={onCreatePr}
          title={createPrDisabledReason ?? "Open a pull request for this branch"}
        >
          <GitPullRequestArrow className="size-4" />
          Create PR
        </Button>
        <div className="relative flex">
          <Button
            size="sm"
            type="button"
            className="rounded-r-none text-[13px]"
            disabled={
              !info?.commits.length || loading || Boolean(pushing) || Boolean(repositoryOperation)
            }
            onClick={() => onPush(false)}
          >
            {pushing === "push" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            Push
          </Button>
          <Button
            size="sm"
            type="button"
            className="w-7 rounded-l-none border-l border-primary-foreground/20"
            disabled={
              !info?.commits.length || loading || Boolean(pushing) || Boolean(repositoryOperation)
            }
            aria-label="Push options"
            aria-expanded={menuOpen}
            onClick={() => onMenuOpenChange(!menuOpen)}
          >
            <ChevronDown className="size-4" />
          </Button>
          {menuOpen && (
            <div className="absolute bottom-full right-0 z-20 mb-2 min-w-48 rounded-md border bg-popover p-1 shadow-xl">
              <button
                type="button"
                className="w-full rounded px-3 py-2 text-left text-[13px] hover:bg-accent"
                onClick={() => onPush(true)}
              >
                <span className="block font-medium">Force Push</span>
                <span className="block text-[11px] text-muted-foreground">
                  Uses force-with-lease
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
