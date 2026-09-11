export type SaveStatus = "clean" | "unsaved" | "saved";

export const isMarkdownPath = (path: string) => /\.(md|markdown|mdx)$/i.test(path);
export const isHtmlPath = (path: string) => /\.html?$/i.test(path);
export const LSP_LABELS: Record<string, string> = {
  typescript: "TypeScript/JavaScript",
  rust: "Rust",
  go: "Go",
  python: "Python",
  json: "JSON",
  css: "CSS",
  html: "HTML",
  yaml: "YAML",
  elixir: "Elixir",
};
export const isSvgPath = (path: string) => /\.svg$/i.test(path);
export const isBinaryImagePath = (path: string) => /\.(png|jpg|jpeg|gif|webp|ico|bmp)$/i.test(path);
// Guard for SSR/test (navigator may be undefined).
export const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
export const SEND_TO_CHAT_HINT = IS_MAC ? "⌘L" : "Ctrl L";
