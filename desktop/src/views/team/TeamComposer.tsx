import { Play, Send } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import {
  type MentionCandidate,
  applyMention,
  mentionAtCaret,
  mentionText,
  rankCandidates,
} from "@/lib/peerFeed";
import { resolveMentions } from "@/lib/peerMentions";
import { cn } from "@/lib/utils";
import type { Channel } from "@/protocol";

const MENU_LIMIT = 8;
const START_LABEL = "Start a session with this text";

interface Props {
  project: string;
  /** The named channel a post goes to; null for `#general`. */
  channel?: Channel | null;
  /** Text to put in the box, e.g. from an empty channel's buttons; a new
   *  nonce applies it again. */
  prefill?: { nonce: number; text: string } | null;
  /** The sessions a channel post can @mention. */
  candidates: MentionCandidate[];
  /** Set for a direct thread: the sessions the user can message in it. */
  targets?: MentionCandidate[];
  onStartSession: (text: string) => void;
}

/**
 * Writes to the team: a channel post (each @mention is handed the post as the
 * user's prompt), or a direct message to one session of a thread.
 */
export function TeamComposer({
  project,
  channel,
  prefill,
  candidates,
  targets,
  onStartSession,
}: Props) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  /** A warning about the post's mentions, and the text it was given for. */
  const [hint, setHint] = useState<{ body: string; text: string } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const direct = targets !== undefined;
  const to = direct ? (targets.find((t) => t.id === target) ?? targets[0]) : undefined;

  const mention = direct ? null : mentionAtCaret(text, caret);
  const matches = useMemo(
    () => (mention ? rankCandidates(candidates, mention.query).slice(0, MENU_LIMIT) : []),
    [candidates, mention],
  );
  const menuOpen = matches.length > 0;

  const pick = (candidate: MentionCandidate) => {
    if (!mention) return;
    const next = applyMention(text, mention, caret, mentionText(candidate, candidates));
    setText(next.text);
    setCaret(next.caret);
    setActive(0);
    pendingCaret.current = next.caret;
  };

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    ref.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  useEffect(() => {
    if (!prefill) return;
    setText(prefill.text);
    setCaret(prefill.text.length);
    pendingCaret.current = prefill.text.length;
    ref.current?.focus();
  }, [prefill]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending || (direct && !to)) return;
    if (!direct) {
      const resolved = resolveMentions(body, candidates);
      const warning = resolved.ambiguous
        ? `@${resolved.ambiguous.mention} matches more than one session. Pick one from the list, which uses its id.`
        : resolved.unmatched.length > 0
          ? `${resolved.unmatched.join(", ")} ${resolved.unmatched.length === 1 ? "matches" : "match"} no session and will be posted as text. Send again to post it anyway.`
          : null;
      const confirmed = hint?.body === body && !resolved.ambiguous;
      if (warning && !confirmed) {
        setHint({ body, text: warning });
        return;
      }
    }
    setHint(null);
    setSending(true);
    try {
      const result = to
        ? await daemon.messageSession(to.id, body)
        : await daemon.postToTeam(project, body, channel?.id);
      setText("");
      setCaret(0);
      if (result.notice) toast(result.notice);
    } catch (error) {
      toast.error(direct ? "Message not sent" : "Post not sent", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((index) => (index + step + matches.length) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(matches[Math.min(active, matches.length - 1)]!);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="relative shrink-0 space-y-2 border-t border-border pt-3">
      {menuOpen && (
        <ul
          role="listbox"
          aria-label="Mention a session"
          className="absolute bottom-full left-0 z-10 mb-1 w-80 overflow-hidden rounded-md border border-border bg-popover py-1 text-[13px] shadow-md"
        >
          {matches.map((candidate, index) => (
            <li
              key={candidate.id}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(candidate);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-2 py-1",
                index === active && "bg-accent",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{candidate.label || candidate.id}</span>
              {candidate.smith ? (
                <span className="shrink-0 text-[11px] text-muted-foreground">smith</span>
              ) : (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {candidate.id}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {direct && targets.length > 1 && (
        <div role="radiogroup" aria-label="Message" className="flex gap-1 text-xs">
          {targets.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="radio"
              aria-checked={candidate.id === to?.id}
              onClick={() => setTarget(candidate.id)}
              className={cn(
                "max-w-48 truncate rounded-md border px-2 py-0.5",
                candidate.id === to?.id
                  ? "border-primary text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      )}
      <div className="bg-deep-surface relative flex flex-col rounded-lg border border-input transition-colors focus-within:border-ring">
        <textarea
          ref={ref}
          value={text}
          rows={2}
          aria-label={direct ? "Message" : "Post to the channel"}
          placeholder={
            direct
              ? `Message ${to?.label ?? "the session"} — it arrives as your prompt`
              : `Post to #${channel?.name ?? "general"}. @mention a session or a smith to hand it the work.`
          }
          onChange={(event) => {
            setText(event.target.value);
            setHint(null);
            setCaret(event.target.selectionStart);
            setActive(0);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          className="max-h-[220px] min-h-[76px] resize-none bg-transparent px-3 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
        />
        {hint && (
          <p role="status" className="px-3 pb-1 text-xs text-warn">
            {hint.text}
          </p>
        )}
        <div className="flex items-center gap-1.5 px-2 pb-2 text-[11px] text-muted-foreground">
          {!direct && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5 [&_svg]:size-3"
              aria-label={START_LABEL}
              title={START_LABEL}
              disabled={!text.trim()}
              onClick={() => onStartSession(text.trim())}
            >
              <Play />
            </Button>
          )}
          <span className="ml-auto shrink-0">⇧↵ newline</span>
          <Button
            type="button"
            size="icon"
            aria-label={direct ? "Send" : "Post"}
            className="size-6 shrink-0"
            disabled={!text.trim() || sending}
            onClick={() => void send()}
          >
            <Send className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
