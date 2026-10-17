import { CHART_COLORS } from "./themes";

/**
 * A Smith's colour when none was picked: stable for its id, so it does not
 * change between renders, windows or restarts.
 * @param id the Smith's id
 * @returns a palette index
 */
export function defaultSmithColor(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % CHART_COLORS;
}

/**
 * @param id the Smith's id
 * @param picked the indices the user picked, by Smith id
 * @returns its palette index, kept in range
 */
export function smithColorIndex(id: string, picked: Readonly<Record<string, number>>): number {
  const index = picked[id];
  return Number.isInteger(index) && index! >= 0 && index! < CHART_COLORS
    ? index!
    : defaultSmithColor(id);
}

/**
 * @param index a palette index
 * @returns the theme token for it, as a CSS colour; `alpha` makes a tint
 */
export function smithColor(index: number, alpha?: number): string {
  const token = `var(--chart-${(index % CHART_COLORS) + 1})`;
  return alpha === undefined ? `hsl(${token})` : `hsl(${token} / ${alpha})`;
}
