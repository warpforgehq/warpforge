import LanguageServersPanel from "@/components/LanguageServersPanel";
import TrackersPanel from "@/components/TrackersPanel";

import { SettingsPage, SettingsSection } from "../primitives";

export default function IntegrationsPage() {
  return (
    <SettingsPage page="integrations">
      <SettingsSection id="language-servers" title="Language servers">
        <LanguageServersPanel />
      </SettingsSection>
      <SettingsSection title="Issue trackers" padded>
        <TrackersPanel />
      </SettingsSection>
    </SettingsPage>
  );
}
