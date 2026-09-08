/**
 * "Is this near the viewport?", shared by every caller.
 *
 * One `IntersectionObserver` for the whole app rather than one per watched
 * node: a diff watches a hunk at a time, and a 60-file pull request would
 * otherwise stand up several hundred observers to ask the same question.
 */

/** How far ahead of the viewport a node still counts as near. Roughly a
 *  screen and a half, so scrolling arrives at content that is already there. */
const MARGIN_PX = 1200;

type Watcher = (near: boolean) => void;

const watchers = new WeakMap<Element, Watcher>();
let observer: IntersectionObserver | null = null;

/** False in jsdom and in webviews old enough to lack the API — callers must
 *  render their content outright rather than wait for an answer. */
export function canObserveViewport(): boolean {
  return typeof IntersectionObserver !== "undefined";
}

export function observeNearViewport(node: Element, onChange: Watcher): () => void {
  if (!canObserveViewport()) {
    onChange(true);
    return () => {};
  }
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) watchers.get(entry.target)?.(entry.isIntersecting);
    },
    { rootMargin: `${MARGIN_PX}px 0px` },
  );
  watchers.set(node, onChange);
  observer.observe(node);
  return () => {
    observer?.unobserve(node);
    watchers.delete(node);
  };
}
