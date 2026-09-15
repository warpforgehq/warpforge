/**
 * Mirrors the motion curves in `globals.css` (`--ease-out`, `--ease-fold`,
 * `--ease-move`) for code that needs a JS-side cubic-bezier, such as
 * framer-motion transitions. CSS custom properties can't be read into a JS
 * tuple at build time, so keep the two files in sync by hand.
 */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
export const EASE_FOLD: [number, number, number, number] = [0.32, 0.72, 0, 1];
export const EASE_MOVE: [number, number, number, number] = [0.4, 0, 0.2, 1];
