import { Button } from "@/components/ui/button";
import { useUi } from "@/store/ui";
import { notificationDefaults } from "@/store/ui/devicePreferences";

import { SettingsPage, SettingsRow, SettingsSection, Toggle } from "../primitives";

const rows = [
  [
    "taskFinishedToast",
    "task-finished-toast",
    "Task-finished toast",
    "Show an in-app alert when an agent finishes a turn or a pipeline completes.",
  ],
  [
    "attentionToast",
    "attention-toast",
    "Needs-you toast",
    "Show an in-app alert when a task needs review, is blocked, or has a question.",
  ],
  [
    "permissionToast",
    "permission-toast",
    "Permission toast",
    "Show an in-app alert when an agent requests permission.",
  ],
  [
    "nativeTaskFinished",
    "native-task-finished",
    "macOS notification on task finish",
    "Show a system banner when work finishes while Warpforge is in the background.",
  ],
] satisfies [keyof typeof notificationDefaults, string, string, string][];

export default function NotificationsPage() {
  const notifications = useUi((s) => s.notifications);
  const setNotification = useUi((s) => s.setNotification);

  const dirty = rows.some(([key]) => notifications[key] !== notificationDefaults[key]);

  return (
    <SettingsPage
      page="notifications"
      actions={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          disabled={!dirty}
          onClick={() => rows.forEach(([key]) => setNotification(key, notificationDefaults[key]))}
        >
          Restore defaults
        </Button>
      }
    >
      <SettingsSection title="In-app and system alerts">
        {rows.map(([key, id, title, description]) => (
          <SettingsRow
            key={key}
            id={id}
            title={title}
            description={description}
            control={
              <Toggle
                id={`${id}-toggle`}
                label={title}
                checked={notifications[key]}
                onChange={(checked) => setNotification(key, checked)}
              />
            }
          />
        ))}
      </SettingsSection>
    </SettingsPage>
  );
}
