/** The public docs site (www/astro.config.ts `site`). */
const DOCS = "https://warpforge.app";

/**
 * @param section a heading anchor in the Smiths guide
 * @returns the guide's URL at that section
 */
export function smithsGuideUrl(section: string): string {
  return `${DOCS}/guides/smiths/#${section}`;
}
