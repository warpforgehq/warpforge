/** The soul section a personality preset writes (the daemon's template). */
const VOICE_HEADING = "## Voice";

/**
 * Replace the body of the soul's `## Voice` section, leaving every other line
 * as the user wrote it. A soul without the section gets one after its title.
 * @param soul the soul text
 * @param voice the new section body
 * @returns the soul with that voice
 */
export function applyVoice(soul: string, voice: string): string {
  const lines = soul.split("\n");
  const start = lines.findIndex((line) => line.trim() === VOICE_HEADING);
  const body = ["", voice.trim(), ""];
  if (start < 0) {
    const title = lines[0]?.startsWith("# ") ? 1 : 0;
    const before = lines.slice(0, title);
    const after = lines.slice(title);
    while (after[0] === "") after.shift();
    return [...before, ...(title ? [""] : []), VOICE_HEADING, ...body, ...after].join("\n");
  }
  let end = lines.findIndex((line, i) => i > start && /^#{1,2} /.test(line));
  if (end < 0) end = lines.length;
  const rest = lines.slice(end);
  return [...lines.slice(0, start + 1), ...body, ...rest].join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * @param soul the soul text
 * @returns the body of its `## Voice` section, or null when it has none
 */
export function voiceOf(soul: string): string | null {
  const lines = soul.split("\n");
  const start = lines.findIndex((line) => line.trim() === VOICE_HEADING);
  if (start < 0) return null;
  let end = lines.findIndex((line, i) => i > start && /^#{1,2} /.test(line));
  if (end < 0) end = lines.length;
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

/**
 * Put a name in the soul's title line (`# Name`), the line the template
 * starts with.
 * @param soul the soul text
 * @param name the Smith's name
 * @returns the soul with that title
 */
export function applyName(soul: string, name: string): string {
  const title = `# ${name.trim() || "Smith"}`;
  return soul.startsWith("# ") ? soul.replace(/^# .*$/m, title) : `${title}\n\n${soul}`;
}
