import { toast } from "sonner";

/**
 * Write to the clipboard, telling the user when the write did not happen.
 *
 * A WebView with no clipboard permission fails silently otherwise, and a
 * "copied" with nothing on the clipboard is worse than an error. Returns
 * whether it worked, for the callers that want to tick.
 */
export async function copyText(value: string, what: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    toast.error(`Could not copy ${what.toLowerCase()}`);
    return false;
  }
}
