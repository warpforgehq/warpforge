import { ChevronDown, GitPullRequestArrow, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { GitPushInfo } from "../../protocol";
import type { RepositoryOperation } from "../../store/ui";

interface PushFooterProps {
  info: GitPushInfo | null;
  loading: boolean;
  pushing: boolean;
  hasPr?: boolean;
  repositoryOperation: RepositoryOperation | null;
  onCreatePr: () => void;
  createPrDisabledReason?: string;
  onPush: (force: boolean) => void;
}

export function PushFooter({
  info,
  loading,
  pushing,
  hasPr,
  repositoryOperation,
  onCreatePr,
  createPrDisabledReason,
  onPush,
}: PushFooterProps) {
  const count = info?.commits.length ?? 0;
  const upToDate = info?.hasUpstream && count === 0;
  const disabled = !info || loading || pushing || Boolean(repositoryOperation);
  const pushDisabled = disabled || Boolean(upToDate);
  return (
    <footer className="flex shrink-0 items-center justify-end gap-2 border-t p-2">
      {!hasPr && (
        <Button
          size="sm"
          type="button"
          variant="outline"
          className="text-[13px]"
          disabled={disabled || Boolean(createPrDisabledReason)}
          onClick={onCreatePr}
          title={createPrDisabledReason ?? "Open a pull request for this branch"}
        >
          <GitPullRequestArrow className="size-4" />
          Create PR
        </Button>
      )}
      <div className="flex">
        <Button
          size="sm"
          type="button"
          variant="secondary"
          className="rounded-r-none text-[13px]"
          disabled={pushDisabled}
          onClick={() => onPush(false)}
          title={
            info && !info.hasUpstream
              ? `First push will create upstream ${info.upstream}.`
              : undefined
          }
        >
          {pushing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {upToDate ? "Up to date" : "Push"}
          {count > 0 && <span className="tnum text-[11px]">↑{count}</span>}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              type="button"
              variant="secondary"
              className="w-7 rounded-l-none border-l border-border"
              disabled={pushDisabled}
              aria-label="Push options"
            >
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent side="top" align="end">
              <DropdownMenuItem onSelect={() => onPush(true)}>
                Force push (force-with-lease)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenu>
      </div>
    </footer>
  );
}
