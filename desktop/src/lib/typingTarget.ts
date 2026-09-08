/**
 * Whether a keyboard event landed in something the user is typing into.
 *
 * Single-letter shortcuts (j/k to walk a list) must not fire while a search
 * box, a comment composer or a rich-text field has focus — otherwise typing
 * "jk" in a filter silently moves the selection out from under the person.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}
