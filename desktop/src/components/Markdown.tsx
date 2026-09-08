import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";

import { MarkdownAlert, splitMarkdownAlert } from "@/components/MarkdownAlert";
import { isExternalLink, openExternalLink } from "@/lib/externalLinks";
import { cn } from "@/lib/utils";

export type FileLinkResolver = (text: string) => string | null;

/**
 * A source the WebView can put in an `<img>` on its own, plus the pieces the
 * fallback link needs. An image whose bytes have to be fetched with someone's
 * tracker credentials cannot be one of these, which is why the whole renderer
 * is replaceable rather than just the URL.
 */
export interface MarkdownImageProps {
  src: string;
  alt: string;
  title?: string;
}

interface MarkdownContextValue {
  resolveFilePath?: FileLinkResolver;
  onOpenFile?: (path: string) => void;
  renderImage?: React.ComponentType<MarkdownImageProps>;
}

const MarkdownContext = createContext<MarkdownContextValue>({});

const MarkdownAnchor: NonNullable<Components["a"]> = ({ children: content, href }) => {
  const { resolveFilePath, onOpenFile } = useContext(MarkdownContext);
  const external = Boolean(href && isExternalLink(href));

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!href) return;
    if (external) {
      event.preventDefault();
      void openExternalLink(href);
      return;
    }
    const filePath = resolveFilePath?.(href);
    if (filePath && onOpenFile) {
      event.preventDefault();
      onOpenFile(filePath);
    }
  };

  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="text-primary underline"
      onClick={handleClick}
    >
      {content}
    </a>
  );
};

const MarkdownCode: NonNullable<Components["code"]> = ({
  className: codeClassName,
  children: content,
  ...rest
}) => {
  const { resolveFilePath, onOpenFile } = useContext(MarkdownContext);
  const inline = !codeClassName;
  const text = String(content ?? "");
  const filePath = inline ? resolveFilePath?.(text) : null;
  if (filePath && onOpenFile) {
    return (
      <button
        type="button"
        className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-primary underline decoration-primary/40 underline-offset-2 hover:bg-secondary hover:decoration-primary"
        title={`Open ${filePath}`}
        onClick={() => onOpenFile(filePath)}
      >
        {content}
      </button>
    );
  }
  return inline ? (
    <code
      className="break-words rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] [overflow-wrap:anywhere]"
      {...rest}
    >
      {content}
    </code>
  ) : (
    <code className={cn("font-mono", codeClassName)} {...rest}>
      {content}
    </code>
  );
};

/** A link out, for an image whose bytes nobody here can get hold of. */
export function MarkdownImageLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline"
      onClick={(event) => {
        event.preventDefault();
        void openExternalLink(href);
      }}
    >
      {label}
    </a>
  );
}

/**
 * Screenshots pasted into an issue are the whole point of half of them, so the
 * image is shown inline and opens full size in the browser on click.
 *
 * `openHref` is what the click opens, which is not always what is displayed:
 * a tracker attachment renders from inlined bytes but should still open the
 * page the URL points at.
 */
export function MarkdownImageFrame({
  src,
  alt,
  title,
  openHref,
  onError,
}: MarkdownImageProps & { openHref?: string; onError?: () => void }) {
  const target = openHref ?? src;
  return (
    <button
      type="button"
      className="my-2 block max-w-full overflow-hidden rounded-md border border-border/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={title ?? `Open ${alt}`}
      onClick={() => void openExternalLink(target)}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={onError}
        className="block max-h-[28rem] max-w-full object-contain"
      />
    </button>
  );
}

/** The default: the WebView fetches the URL itself. */
function DirectImage({ src, alt, title }: MarkdownImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <MarkdownImageLink href={src} label={alt} />;
  return <MarkdownImageFrame src={src} alt={alt} title={title} onError={() => setFailed(true)} />;
}

const MarkdownImage: NonNullable<Components["img"]> = ({ alt, src, title }) => {
  const { renderImage: Image = DirectImage } = useContext(MarkdownContext);
  if (typeof src !== "string" || src === "") return null;
  return <Image src={src} alt={alt || "Image"} title={title} />;
};

const MARKDOWN_COMPONENTS: Components = {
  a: MarkdownAnchor,
  img: MarkdownImage,
  blockquote: ({ children: content }) => {
    // GitHub's alerts are blockquotes with a marker in their first line.
    const alert = splitMarkdownAlert(content);
    if (alert) return <MarkdownAlert kind={alert.kind}>{alert.body}</MarkdownAlert>;
    return (
      <blockquote className="my-1 border-l-2 border-border pl-3 text-muted-foreground">
        {content}
      </blockquote>
    );
  },
  code: MarkdownCode,
  // Only reachable with `allowHtml`; GitHub collapses release notes into these.
  details: ({ children: content }) => (
    <details className="my-1.5 rounded-md border border-border/70 px-2.5 py-1.5">{content}</details>
  ),
  summary: ({ children: content }) => (
    <summary className="cursor-pointer text-sm font-medium text-foreground/90">{content}</summary>
  ),
  h1: ({ children: content }) => <h1 className="mb-1 mt-2 text-base font-semibold">{content}</h1>,
  h2: ({ children: content }) => <h2 className="mb-1 mt-2 text-sm font-semibold">{content}</h2>,
  h3: ({ children: content }) => <h3 className="mb-1 mt-2 text-sm font-semibold">{content}</h3>,
  ol: ({ children: content }) => <ol className="my-1 list-decimal space-y-0.5 pl-5">{content}</ol>,
  p: ({ children: content }) => <p className="my-1">{content}</p>,
  pre: ({ children: content }) => (
    <pre className="my-2 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/50 p-2.5 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">
      {content}
    </pre>
  ),
  table: ({ children: content }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-xs">{content}</table>
    </div>
  ),
  td: ({ children: content }) => <td className="border border-border px-2 py-1">{content}</td>,
  th: ({ children: content }) => (
    <th className="border border-border px-2 py-1 text-left">{content}</th>
  ),
  ul: ({ children: content }) => <ul className="my-1 list-disc space-y-0.5 pl-5">{content}</ul>,
};

/**
 * How much room the prose gets. `compact` is chat: many short messages in a
 * scroller, where tight spacing is what makes the transcript readable.
 * `comfortable` is a document read once — an issue description — where the
 * same spacing reads as cramped. Both scale off the user's font size, so this
 * is relative density, not a second font-size setting.
 *
 * The block rhythm is set here rather than in `MARKDOWN_COMPONENTS` so the two
 * densities share one set of element renderers: the wrapper spaces the blocks
 * and cancels their own margins.
 */
export type MarkdownDensity = "compact" | "comfortable";

const DENSITY_CLASS: Record<MarkdownDensity, string> = {
  compact: "typeset typeset-chat",
  comfortable:
    "space-y-3 text-[0.9375rem] leading-7 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-base [&_li]:my-0.5 [&_ol]:my-0 [&_p]:my-0 [&_ul]:my-0",
};

/**
 * What survives `allowHtml`. GitHub's own bodies lean on `<details>` for
 * release notes and dependency bumps, and neither tag is in the default
 * schema; everything dangerous (script, style, event handlers, unknown
 * protocols) is dropped by the schema we extend.
 */
const HTML_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"],
  attributes: {
    ...defaultSchema.attributes,
    details: [...(defaultSchema.attributes?.details ?? []), "open"],
    img: [...(defaultSchema.attributes?.img ?? []), "alt", "title"],
  },
};

/** Raw HTML costs a second parse and a sanitiser pass, so it is opt-in.
 *  Order matters: raw parses the tags, sanitise then throws most of them out. */
const HTML_PLUGINS: PluggableList = [rehypeRaw, [rehypeSanitize, HTML_SCHEMA]];

/** Agent/user messages rendered as GitHub-flavored markdown, tailwind-styled. */
export function Markdown({
  children,
  className,
  density = "compact",
  resolveFilePath,
  onOpenFile,
  renderImage,
  allowHtml = false,
}: {
  children: string;
  className?: string;
  density?: MarkdownDensity;
  resolveFilePath?: FileLinkResolver;
  onOpenFile?: (path: string) => void;
  /** Replaces how images load — see `MarkdownImageProps`. */
  renderImage?: React.ComponentType<MarkdownImageProps>;
  /**
   * Render embedded HTML instead of printing it.
   *
   * Off by default, and deliberately so: agent output has no need of it, and
   * this text arrives over the network. Tracker bodies are the exception —
   * GitHub's release notes and Dependabot's descriptions are mostly
   * `<details>`/`<blockquote>` markup, which used to show up as visible tag
   * soup. Those turn it on, and everything then passes through
   * `HTML_SCHEMA`.
   */
  allowHtml?: boolean;
}) {
  const context = useMemo(
    () => ({ onOpenFile, renderImage, resolveFilePath }),
    [onOpenFile, renderImage, resolveFilePath],
  );

  return (
    <div
      className={cn(
        "min-w-0 break-words [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        DENSITY_CLASS[density],
        className,
      )}
    >
      <MarkdownContext.Provider value={context}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={allowHtml ? HTML_PLUGINS : undefined}
          components={MARKDOWN_COMPONENTS}
        >
          {children}
        </ReactMarkdown>
      </MarkdownContext.Provider>
    </div>
  );
}

const STREAM_MARKDOWN_INTERVAL_MS = 80;
const MAX_COLLAPSED_MESSAGE_LENGTH = 600;
const MAX_COLLAPSED_MESSAGE_LINES = 8;
/**
 * How much text a collapsed message actually renders. Generous next to the
 * 8-line threshold — the clip is `max-h-44`, and a little slack keeps the fade
 * looking like there is more underneath — but bounded, which is the point.
 */
const COLLAPSED_RENDER_LINES = 20;
const COLLAPSED_RENDER_CHARS = 2000;

/**
 * The prefix of a message worth rendering while it is clipped.
 *
 * Collapsing used to be purely visual: the full text was parsed, highlighted
 * and laid out, then hidden behind `max-h-44`. A pasted log of a few thousand
 * lines therefore cost its full render for 176px of visible output, and paid
 * it synchronously — the main thread stalled long enough that text could not
 * be selected and the composer would not accept input until it finished.
 *
 * Cutting mid-document can leave a code fence open, which would swallow the
 * rest of the prefix into one code block, so an odd fence count gets closed.
 */
function collapsedPrefix(text: string): string {
  const lines = text.split("\n");
  let prefix = lines.slice(0, COLLAPSED_RENDER_LINES).join("\n");
  if (prefix.length > COLLAPSED_RENDER_CHARS) {
    prefix = prefix.slice(0, COLLAPSED_RENDER_CHARS);
  }
  if (prefix.length === text.length) return text;
  const fences = prefix.match(/^```/gm)?.length ?? 0;
  return fences % 2 === 1 ? `${prefix}\n\`\`\`` : prefix;
}
const COLLAPSED_MESSAGE_MASK =
  "linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)";

/** Bounds historical message geometry while keeping the full text one click away. */
export function CollapsibleMarkdown({
  children,
  className,
  resolveFilePath,
  onOpenFile,
}: {
  children: string;
  className?: string;
  resolveFilePath?: FileLinkResolver;
  onOpenFile?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible =
    children.length > MAX_COLLAPSED_MESSAGE_LENGTH ||
    children.split("\n").length > MAX_COLLAPSED_MESSAGE_LINES;
  const collapsed = collapsible && !expanded;

  return (
    <div>
      <div
        className={cn("relative", collapsed && "max-h-44 overflow-hidden")}
        style={
          collapsed
            ? {
                WebkitMaskImage: COLLAPSED_MESSAGE_MASK,
                maskImage: COLLAPSED_MESSAGE_MASK,
              }
            : undefined
        }
      >
        <Markdown className={className} resolveFilePath={resolveFilePath} onOpenFile={onOpenFile}>
          {collapsed ? collapsedPrefix(children) : children}
        </Markdown>
      </div>
      {collapsible && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-1.5 h-6 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? "Show less" : "Show full message"}
        </button>
      )}
    </div>
  );
}

/**
 * Markdown for actively-streaming assistant text. ACP emits sub-word deltas;
 * re-parsing GFM on every one starves the main thread (composer input, scroll).
 * This renders the first value immediately, then coalesces later changes to at
 * most one re-parse per interval, always converging on the latest text — the
 * final delta of a turn flushes within one interval.
 */
export const BufferedMarkdown = memo(function BufferedMarkdown({
  children,
  intervalMs = STREAM_MARKDOWN_INTERVAL_MS,
  ...rest
}: {
  children: string;
  className?: string;
  resolveFilePath?: FileLinkResolver;
  onOpenFile?: (path: string) => void;
  intervalMs?: number;
}) {
  const [display, setDisplay] = useState(children);
  const latest = useRef(children);

  useEffect(() => {
    latest.current = children;
  }, [children]);

  useEffect(() => {
    const timer = setInterval(() => {
      setDisplay((current) => (current === latest.current ? current : latest.current));
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return <Markdown {...rest}>{display}</Markdown>;
});
