import { connected, deref, mapGet, mapSet, weakGet, weakSet, WeakRefOf } from "./builtins";

// A WeakMap tags elements without touching the DOM, so an element keeps its ref
// across snapshots until the page drops it.
const refs = new Map<string, WeakRef<Element>>();
const ids = new WeakMap<Element, string>();
let nextRef = 1;

export function refFor(el: Element): string {
  let id = weakGet.call(ids, el) as string | undefined;
  if (!id) {
    id = `e${nextRef++}`;
    weakSet.call(ids, el, id);
    mapSet.call(refs, id, new WeakRefOf(el));
  }
  return id;
}

export function lookup(ref: string): Element | null {
  const held = mapGet.call(refs, ref) as WeakRef<Element> | undefined;
  const el = held ? deref.call(held) : undefined;
  return el && connected.call(el) ? el : null;
}

export function missing(ref: string): { error: string } {
  return { error: `No element ${ref} on the page any more; take a new browser_snapshot.` };
}

export function existingRef(el: Element): string | null {
  return (weakGet.call(ids, el) as string | undefined) ?? null;
}
