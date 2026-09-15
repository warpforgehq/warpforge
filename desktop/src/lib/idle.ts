/**
 * Run `callback` off the current frame. `requestIdleCallback` where the WebView
 * has it; a macrotask otherwise (jsdom, older Safari), so callers never branch.
 * Returns a canceller for effect cleanup.
 */
export function runOnIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(callback, { timeout: 2_000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(callback, 200);
  return () => clearTimeout(handle);
}
