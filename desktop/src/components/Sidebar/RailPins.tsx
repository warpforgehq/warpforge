import { Hash } from "lucide-react";
import { useEffect, useSyncExternalStore, type DragEvent } from "react";

import { SmithAvatar } from "@/components/SmithAvatar";
import { daemon } from "@/daemon";
import { useContextMenu } from "@/hooks/useContextMenu";
import { defaultSmithColor, smithColor } from "@/lib/smithColors";
import { cn } from "@/lib/utils";
import { pinKey, usePins, type Pin } from "@/store/pins";
import { useSmithsStore } from "@/store/smiths";
import { useUi } from "@/store/ui";

import { RailButton } from "./RailButton";

const PIN_DRAG_MIME = "application/x-warpforge-pin";

function ProjectTile({ name }: { name: string }) {
  const index = defaultSmithColor(name);
  return (
    <span
      aria-hidden
      style={{ backgroundColor: smithColor(index, 0.18), color: smithColor(index) }}
      className="grid size-6 place-items-center rounded-md text-[0.75rem] font-bold uppercase leading-none"
    >
      {name.slice(0, 1)}
    </span>
  );
}

/** Whether the main area is showing what `pin` points at. */
function usePinActive(pin: Pin): boolean {
  return useUi((s) => {
    if (s.openTaskId || s.settingsOpen) return false;
    if (pin.kind === "project") return s.view === "project" && s.selectedProjectId === pin.id;
    const selection = s.view === "team" ? s.teamSelection : null;
    if (!selection) return false;
    return pin.kind === "smith"
      ? selection.kind === "teammate" && selection.id === pin.id
      : selection.kind === "conversation" && selection.key === pin.id;
  });
}

function PinButton({
  pin,
  index,
  roving,
}: {
  pin: Pin;
  index: number;
  roving: (key: string) => { onFocus: () => void; tabIndex: number };
}) {
  const smith = useSmithsStore((s) => (pin.kind === "smith" ? s.smiths[pin.id] : undefined));
  const active = usePinActive(pin);
  const openContextMenu = useContextMenu();
  const key = pinKey(pin);

  const label =
    pin.kind === "project"
      ? pin.id
      : pin.kind === "smith"
        ? (smith?.name ?? "Smith")
        : `#${pin.name}`;

  const open = () => {
    const ui = useUi.getState();
    if (pin.kind === "project") {
      ui.setSidebarMode("tasks");
      ui.openProject(pin.id);
    } else {
      ui.setSidebarMode("team");
      ui.openTeam(
        pin.kind === "smith"
          ? { id: pin.id, kind: "teammate" }
          : { key: pin.id, kind: "conversation" },
      );
    }
  };

  return (
    <RailButton
      label={label}
      tooltip={`${label} · pinned`}
      onClick={open}
      draggable
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.setData(PIN_DRAG_MIME, key);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event: DragEvent) => {
        if (event.dataTransfer.types.includes(PIN_DRAG_MIME)) event.preventDefault();
      }}
      onDrop={(event: DragEvent) => {
        const dragged = event.dataTransfer.getData(PIN_DRAG_MIME);
        if (dragged && dragged !== key) usePins.getState().move(dragged, index);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        openContextMenu({
          at: { x: event.clientX, y: event.clientY },
          items: [{ type: "item", id: "unpin", label: "Unpin from rail" }],
          handlers: new Map([["unpin", () => usePins.getState().toggle(pin)]]),
        });
      }}
      className={cn(active && "bg-accent/60")}
      {...roving(`pin:${key}`)}
    >
      <span
        data-pin={key}
        className={cn(
          "grid place-items-center rounded-md",
          active && "ring-[1.5px] ring-primary ring-offset-2 ring-offset-chrome",
          pin.kind === "smith" && "rounded-full",
        )}
      >
        {pin.kind === "project" ? (
          <ProjectTile name={pin.id} />
        ) : pin.kind === "smith" ? (
          <SmithAvatar smith={{ id: pin.id, name: smith?.name ?? "?" }} />
        ) : (
          <span className="grid size-6 place-items-center rounded-md bg-muted-foreground/15 text-muted-foreground">
            <Hash aria-hidden className="size-3.5" strokeWidth={2.25} />
          </span>
        )}
      </span>
    </RailButton>
  );
}

/**
 * Projects, Smiths and channels kept on the rail. Right-click a project or a
 * Smith in the panel to pin it; drag to reorder; right-click a pin to unpin.
 * @param roving the rail's roving tab stop
 * @returns the pins, or nothing
 */
export function RailPins({
  roving,
}: {
  roving: (key: string) => { onFocus: () => void; tabIndex: number };
}) {
  const pins = usePins((s) => s.pins);
  const prune = usePins((s) => s.prune);
  const { snapshot, connection } = useSyncExternalStore(daemon.subscribe, daemon.getState);
  const smiths = useSmithsStore((s) => s.smiths);

  useEffect(() => {
    if (connection !== "connected") return;
    const projects = new Set(snapshot.projects.map((project) => project.name));
    prune((pin) =>
      pin.kind === "project"
        ? projects.has(pin.id)
        : pin.kind === "smith"
          ? Object.keys(smiths).length === 0 || pin.id in smiths
          : true,
    );
  }, [connection, snapshot.projects, smiths, prune]);

  if (pins.length === 0) return null;
  return (
    <>
      {pins.map((pin, index) => (
        <PinButton key={pinKey(pin)} pin={pin} index={index} roving={roving} />
      ))}
    </>
  );
}
