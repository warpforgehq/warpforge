import { useQuery } from "@tanstack/react-query";

import {
  MarkdownImageFrame,
  MarkdownImageLink,
  type MarkdownImageProps,
} from "@/components/Markdown";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { daemon } from "@/daemon";

/**
 * An image from an issue body, loaded through the daemon.
 *
 * The WebView carries no GitHub or Linear session, so a `<img src>` straight
 * at an attachment URL gets a 404 for exactly the pictures worth showing —
 * every screenshot in a private repository's issues. The daemon holds the
 * credentials the import already used, so it fetches the bytes and they render
 * from a data URL. Clicking still opens the original URL, where the browser's
 * own session takes over.
 *
 * Anything the daemon cannot get (no `gh` login, a host it will not call)
 * degrades to the link, which is strictly better than a broken image.
 */
export function TrackerImage({ src, alt, title }: MarkdownImageProps) {
  const attachment = useQuery({
    // Bytes, and possibly megabytes, held for the session: reopening a work
    // item must show its screenshots immediately, not re-download them after a
    // minute and paint the placeholder again.
    gcTime: 60_000,
    queryFn: () => daemon.trackerAttachment(src),
    queryKey: ["trackerAttachment", src],
    // The signed URL behind an attachment is short-lived, but the daemon
    // re-resolves it on each call, so the cached bytes never go stale.
    staleTime: Infinity,
  });

  if (attachment.isPending) {
    return (
      <SkeletonBlock
        role="status"
        aria-label={alt}
        data-testid="tracker-image-skeleton"
        className="my-2 block aspect-video max-w-sm rounded-md"
      />
    );
  }
  if (!attachment.data) return <MarkdownImageLink href={src} label={alt} />;

  return (
    <MarkdownImageFrame
      src={`data:${attachment.data.contentType};base64,${attachment.data.dataBase64}`}
      alt={alt}
      title={title}
      openHref={src}
    />
  );
}
