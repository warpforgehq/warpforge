import type { SettingsPage } from "@/store/ui";

const index = {
  appearance: [
    ["theme", "Theme", "color colour dark light forge paper palette"],
    ["ui-font-size", "UI font size", "text zoom size scale"],
    ["mono-font-size", "Mono font size", "code terminal diff text zoom"],
    ["transparent-window", "Transparent window", "glass translucency desktop"],
    ["glass-opacity", "Glass opacity", "transparency sidebar"],
    ["blur-radius", "Blur radius", "glass background macos"],
    ["main-pane-glass", "Main pane glass", "transparent body content"],
    ["theomod", "TheoMod", "privacy blur email addresses"],
  ],
  notifications: [
    ["task-finished-toast", "Task-finished toast", "completion finished done in-app notification"],
    [
      "attention-toast",
      "Needs-you toast",
      "attention review blocked interrupted workflow question in-app notification",
    ],
    [
      "permission-toast",
      "Permission toast",
      "approval allow deny permission request in-app notification",
    ],
    [
      "native-task-finished",
      "macOS notification on task finish",
      "banner native system desktop completion background",
    ],
  ],
  agents: [
    ["default-agent", "Default agent", "new task preselect harness start"],
    ["default-model", "Default model", "new task preselect default agent start"],
    [
      "agent-setup",
      "Agents and their models",
      "install update enable disable refresh detect probe Claude Codex OpenCode Pi models model list custom model ids add remove provider pickers hide show visibility",
    ],
    ["accounts", "Accounts & usage", "import login authentication switch quota spending"],
  ],
  tasks: [
    ["confirm-delete-task", "Confirm before deleting a task", "delete confirmation remove chat"],
    ["confirm-archive-task", "Confirm before archiving a task", "archive confirmation close task"],
    [
      "confirm-close-terminal",
      "Confirm before closing a terminal tab",
      "terminal confirmation close shell",
    ],
    ["auto-name-tasks", "Auto-name tasks", "generate title task text"],
    ["text-gen-agent", "Agent for git text", "generate commit pull request description"],
    ["text-gen-model", "Model for git text", "generate commit pull request description title"],
    ["transcript-retention", "Keep transcripts for", "history retention conversation chat prune"],
    ["auto-settle", "Settle ignored tasks after", "history cleanup archive retention finished"],
    [
      "closed-task-expiry",
      "Delete closed tasks after",
      "history cleanup retention worktree expiry",
    ],
  ],
  integrations: [
    [
      "language-servers",
      "Language servers",
      "lsp install updates go to definition autocomplete diagnostics TypeScript Rust Go Python JSON CSS HTML YAML",
    ],
    ["linear", "Linear", "issue tracker integration API key teams connect"],
    ["github", "GitHub", "issue tracker integration personal access token connect"],
  ],
  memory: [["embedding-mode", "Embedding mode", "memory search keywords fts hybrid fastembed"]],
  advanced: [
    ["backlog-storage", "Backlog storage", "sqlite yaml files"],
    ["dream-now", "Dream now", "memory dreaming compaction project dry run"],
  ],
} satisfies Record<SettingsPage, [id: string, title: string, keywords: string][]>;

export const settingsSearchIndex = Object.entries(index).flatMap(([page, rows]) =>
  rows.map(([id, title, keywords]) => ({ page: page as SettingsPage, id, title, keywords })),
);

export function searchSettings(query: string) {
  const terms = query.toLowerCase().trim().split(/\s+/);
  if (!terms[0]) return [];
  return settingsSearchIndex.filter(({ title, keywords }) => {
    const text = `${title} ${keywords}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
