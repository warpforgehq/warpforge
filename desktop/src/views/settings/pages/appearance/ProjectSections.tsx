import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { orderedSections, visibleSections } from "@/lib/projectSections";
import { useUi } from "@/store/ui";
import { PROJECT_SECTIONS } from "@/views/projects/sections";

import { SettingsRow, SettingsSection, Toggle } from "../../primitives";

/** Appearance → Project sections: which sections a project lists, and in what order. */
export function ProjectSections() {
  const prefs = useUi((s) => s.projectSections);
  const setHidden = useUi((s) => s.setProjectSectionHidden);
  const move = useUi((s) => s.moveProjectSection);
  const order = orderedSections(prefs);
  const visible = visibleSections(prefs);

  return (
    <SettingsSection id="project-sections" title="Project sections">
      {order.map((id, index) => {
        const { label, icon: Icon } = PROJECT_SECTIONS.find((section) => section.id === id)!;
        const shown = visible.includes(id);
        const last = shown && visible.length === 1;
        return (
          <SettingsRow
            key={id}
            icon={<Icon className="size-4 text-muted-foreground" />}
            title={label}
            description={last ? "At least one section stays visible." : undefined}
            control={
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="w-7 p-0 text-muted-foreground"
                  aria-label={`Move ${label} up`}
                  disabled={index === 0}
                  onClick={() => move(id, -1)}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="w-7 p-0 text-muted-foreground"
                  aria-label={`Move ${label} down`}
                  disabled={index === order.length - 1}
                  onClick={() => move(id, 1)}
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Toggle
                  id={`project-section-${id}`}
                  label={`Show ${label}`}
                  checked={shown}
                  disabled={last}
                  onChange={(on) => setHidden(id, !on)}
                />
              </>
            }
          />
        );
      })}
    </SettingsSection>
  );
}
