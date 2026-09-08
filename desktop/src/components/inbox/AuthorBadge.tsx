import { Avatar, AvatarFallback } from "@/components/ui/avatar";

/**
 * One person on a pull request, as initials.
 *
 * Not an image: the WebView's CSP allows only local media (ADR-0010,
 * invariant 6), so a remote avatar URL cannot go in an `<img>` and routing
 * the bytes through the daemon is not worth it. A `[bot]` suffix keeps its
 * own initial, so `gemini-code-assist` and `mimir-code-assist[bot]` stay
 * distinguishable at 16px.
 */
export function AuthorBadge({ login, size = 5 }: { login: string; size?: number }) {
  const initial = login.trim().charAt(0).toUpperCase() || "?";
  return (
    <Avatar className="shrink-0" style={{ width: `${size * 4}px`, height: `${size * 4}px` }}>
      <AvatarFallback className="bg-secondary text-xs font-semibold text-muted-foreground">
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}
