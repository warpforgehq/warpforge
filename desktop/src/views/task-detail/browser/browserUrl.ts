/**
 * Turn whatever the user typed in the address bar into a URL to navigate to.
 *
 * Three cases, in order: a real URL with a scheme is used as-is; a bare host
 * like `github.com` or `localhost:3000` gets `https://`; anything else is a
 * search query.
 */
const SEARCH = "https://duckduckgo.com/?q=";

/** A token that could be `host`, `host:port`, or `host/path` — no spaces, and
 *  either a dot or an explicit port/localhost. */
const HOST_LIKE = /^[^\s]+\.[^\s]+$|^localhost(:\d+)?(\/.*)?$|^[^\s]+:\d+(\/.*)?$/i;

export function toNavigationUrl(input: string): string {
  const text = input.trim();
  if (text.length === 0) return "about:blank";

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  if (/^about:/i.test(text)) return text;

  if (HOST_LIKE.test(text)) return `https://${text}`;

  return `${SEARCH}${encodeURIComponent(text)}`;
}

/** What to show in the address bar for a URL — the search query bare, a real
 *  URL unchanged. Keeps the bar readable instead of echoing the search prefix. */
export function toDisplayUrl(url: string): string {
  if (url.startsWith(SEARCH)) {
    return decodeURIComponent(url.slice(SEARCH.length).replace(/\+/g, " "));
  }
  return url === "about:blank" ? "" : url;
}
