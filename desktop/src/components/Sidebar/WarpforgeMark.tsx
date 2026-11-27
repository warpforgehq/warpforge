/**
 * The Warpforge mark: a W whose last stroke rises into an F. Traced from the
 * app icon, so it renders in `currentColor` on every theme.
 *
 * @param className sizing and colour classes for the `<svg>`.
 * @returns the mark as an inline SVG, hidden from assistive tech.
 */
export function WarpforgeMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="78 152 354 212"
      fill="currentColor"
      className={className}
      data-testid="warpforge-mark"
    >
      <path d="M82 157H123L185 261L214 219L240 256L302 158H428L408 190H320L241 324L215 284L187 327Z" />
      <path d="M314 226H384L365 256H330L267 360H264V307Z" />
    </svg>
  );
}
