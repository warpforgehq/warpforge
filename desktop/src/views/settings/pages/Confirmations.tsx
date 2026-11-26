import { useUi } from "@/store/ui";
import { confirmationDefaults } from "@/store/ui/devicePreferences";

import { Section, SettingRow, Toggle } from "../primitives";

const rows = [
  [
    "deleteTask",
    "confirm-delete-task",
    "Confirm before deleting a task",
    "Ask before permanently deleting a task or chat.",
  ],
  [
    "archiveTask",
    "confirm-archive-task",
    "Confirm before archiving a task",
    "Ask before moving a task to the archive.",
  ],
  [
    "closeTerminal",
    "confirm-close-terminal",
    "Confirm before closing a terminal tab",
    "Ask before closing or removing a terminal tab.",
  ],
] satisfies [keyof typeof confirmationDefaults, string, string, string][];

export function Confirmations() {
  const confirmations = useUi((s) => s.confirmations);
  const setConfirmation = useUi((s) => s.setConfirmation);

  return (
    <Section title="Confirmations">
      {rows.map(([key, id, title, description]) => (
        <SettingRow
          key={key}
          id={id}
          title={title}
          description={description}
          control={
            <Toggle
              id={`${id}-toggle`}
              label={title}
              checked={confirmations[key]}
              onChange={(checked) => setConfirmation(key, checked)}
            />
          }
        />
      ))}
    </Section>
  );
}
