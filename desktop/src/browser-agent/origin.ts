// A plain loop, so a page that patched Array methods cannot widen the list.
export function allowed(origins: string[] | undefined, origin: string): boolean {
  if (!origins) return false;
  for (let i = 0; i < origins.length; i += 1) {
    if (origins[i] === origin) return true;
  }
  return false;
}
