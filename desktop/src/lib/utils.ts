import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** Knows the app's own `rounded-control` radius token, so overrides merge. */
const twMerge = extendTailwindMerge({ extend: { theme: { radius: ["control"] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
