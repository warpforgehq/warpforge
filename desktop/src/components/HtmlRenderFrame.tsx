import { PanelTop } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useHtmlRenderTheme } from "@/hooks/useHtmlRenderTheme";
import {
  htmlRenderFrameHeight,
  htmlRenderResult,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
  readContentHeight,
  readLinkRequest,
  renderUrl,
} from "@/lib/htmlRender";
import type { SessionUpdate } from "@/protocol";
import { openRenderLink } from "@/views/task-detail/browser/openRenderLink";

type HtmlRender = Extract<SessionUpdate, { kind: "html_render" }>;

/**
 * An agent's HTML page inline in the chat, on the chat's own background. It
 * holds the agent's height until the page reports its own, then fits it.
 * @param update the recorded render
 * @param taskId the task whose chat shows it
 * @param compact render a one-line summary for mission-control tiles
 * @returns the frame
 */
export function HtmlRenderFrame({
  update,
  taskId,
  compact,
}: {
  update: HtmlRender;
  taskId?: string;
  compact?: boolean;
}) {
  if (compact || !taskId) {
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <PanelTop className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 truncate text-foreground">Page · {update.title}</span>
      </p>
    );
  }
  return <RenderDocument update={update} taskId={taskId} />;
}

function RenderDocument({ update, taskId }: { update: HtmlRender; taskId: string }) {
  const theme = useHtmlRenderTheme();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [contentHeight, setContentHeight] = useState<number>();
  const [loaded, setLoaded] = useState(false);
  // A new src would reload the page, so a theme change is posted instead.
  const [src] = useState(
    () => `${renderUrl(taskId, update.render_id)}${htmlRenderThemeFragment(theme)}`,
  );

  const postTheme = () => {
    frameRef.current?.contentWindow?.postMessage(htmlRenderThemeMessage(theme), "*");
  };
  useEffect(postTheme, [theme]);

  // Listening from the commit that inserts the frame: a fast page posts its
  // height before a passive effect would run.
  useLayoutEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const height = readContentHeight(event.data);
      if (height !== undefined) {
        setContentHeight(height);
        return;
      }
      const link = readLinkRequest(event.data);
      // A page can click its own links by script; only a reader's click,
      // with this frame focused, opens anything.
      if (
        !link ||
        document.activeElement !== frame ||
        navigator.userActivation?.isActive === false
      ) {
        return;
      }
      openRenderLink(taskId, link.url);
      frame.contentWindow?.postMessage(htmlRenderResult(link.id), "*");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [taskId]);

  return (
    <div
      className="relative w-full min-w-0"
      style={{ height: htmlRenderFrameHeight(update.height, contentHeight) }}
    >
      <iframe
        ref={frameRef}
        src={src}
        title={update.title}
        // Never allow-same-origin: the opaque origin is what keeps the page
        // away from the app and its IPC (docs/adr/0025).
        sandbox="allow-scripts allow-forms"
        loading="lazy"
        className="block size-full border-0"
        // Until the page is in, a frame whose scheme differs from the blank
        // document's paints an opaque canvas and flashes white in dark mode.
        style={loaded ? { colorScheme: theme.appearance } : undefined}
        onLoad={() => {
          setLoaded(true);
          postTheme();
        }}
      />
    </div>
  );
}
