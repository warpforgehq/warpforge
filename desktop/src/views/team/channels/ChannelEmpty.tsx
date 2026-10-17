import { AtSign, Megaphone, Play } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * An empty channel: what it is for and three ways to start it.
 * @param props.name the channel name, without `#`
 * @param props.general whether it is the project's `#general`
 * @param props.smithName a Smith to address first, when there is one
 * @param props.onPrefill puts text in the composer
 * @param props.onStartSession opens New Task for this project
 * @returns the empty state
 */
export function ChannelEmpty({
  name,
  general,
  smithName,
  onPrefill,
  onStartSession,
}: {
  name: string;
  general: boolean;
  smithName: string | null;
  onPrefill: (text: string) => void;
  onStartSession: () => void;
}) {
  return (
    <li className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-10 text-center">
      <h3 className="text-base font-semibold">Start #{name}</h3>
      <p className="text-[13px] text-muted-foreground">
        {general ? "Every session in the project" : "Its Smiths"} read new posts with their next
        prompt. @mention a session or a smith to hand it the work right away.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {smithName && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPrefill(`@${smithName} `)}
          >
            <AtSign className="size-3.5" />
            {smithName} …
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => onPrefill("Update: ")}>
          <Megaphone className="size-3.5" />
          Post an update
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onStartSession}>
          <Play className="size-3.5" />
          Start a session
        </Button>
      </div>
    </li>
  );
}
