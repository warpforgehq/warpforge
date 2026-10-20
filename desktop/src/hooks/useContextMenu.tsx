import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

/** One entry in a data-driven context menu. `id` keys the handler map. */
export type ContextMenuEntry =
  | {
      type: "item";
      id: string;
      label: string;
      disabled?: boolean;
      destructive?: boolean;
      shortcut?: string;
    }
  | { type: "separator" }
  | { type: "label"; label: string }
  | {
      type: "checkbox";
      id: string;
      label: string;
      checked: boolean;
      disabled?: boolean;
    }
  | {
      type: "submenu";
      id: string;
      label: string;
      disabled?: boolean;
      items: ContextMenuEntry[];
    };

export interface ShowContextMenuRequest {
  /** Viewport coordinates of the pointer that opened the menu. */
  at: { x: number; y: number };
  items: ContextMenuEntry[];
  handlers: Map<string, () => void>;
}

type OpenContextMenu = (request: ShowContextMenuRequest) => void;

const ContextMenuContext = createContext<OpenContextMenu | null>(null);

/**
 * Hosts one Radix context menu for the whole app. Call sites describe their
 * items and handlers; the menu opens wherever the pointer was.
 */
export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ShowContextMenuRequest | null>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const openMenu = useCallback<OpenContextMenu>((next) => {
    setRequest(next);
    setOpen(true);
  }, []);

  // Radix only opens from a real `contextmenu` event: replay it on a hidden
  // trigger parked at the requested point so the menu anchors there.
  useEffect(() => {
    if (!open || !request) return;
    triggerRef.current?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: request.at.x,
        clientY: request.at.y,
      }),
    );
  }, [open, request]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setRequest(null);
  };

  return (
    <ContextMenuContext.Provider value={openMenu}>
      {children}
      <ContextMenu open={open} onOpenChange={handleOpenChange}>
        <ContextMenuTrigger asChild>
          <span
            ref={triggerRef}
            aria-hidden="true"
            className="pointer-events-none fixed size-0"
            style={{ left: request?.at.x ?? 0, top: request?.at.y ?? 0 }}
          />
        </ContextMenuTrigger>
        <ContextMenuPortal>
          <ContextMenuContent>
            {request && renderEntries(request.items, request.handlers)}
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenu>
    </ContextMenuContext.Provider>
  );
}

function renderEntries(items: ContextMenuEntry[], handlers: Map<string, () => void>): ReactNode {
  const nodes: ReactNode[] = [];
  let previousKey = "menu";
  for (const item of items) {
    const key =
      item.type === "separator"
        ? `${previousKey}-separator`
        : item.type === "label"
          ? `${previousKey}-${item.label}`
          : item.id;
    previousKey = key;
    switch (item.type) {
      case "separator":
        nodes.push(<ContextMenuSeparator key={key} />);
        break;
      case "label":
        nodes.push(<ContextMenuLabel key={key}>{item.label}</ContextMenuLabel>);
        break;
      case "checkbox":
        nodes.push(
          <ContextMenuCheckboxItem
            key={key}
            checked={item.checked}
            disabled={item.disabled}
            onSelect={() => handlers.get(item.id)?.()}
          >
            {item.label}
          </ContextMenuCheckboxItem>,
        );
        break;
      case "submenu":
        nodes.push(
          <ContextMenuSub key={key}>
            <ContextMenuSubTrigger disabled={item.disabled}>{item.label}</ContextMenuSubTrigger>
            <ContextMenuSubContent>{renderEntries(item.items, handlers)}</ContextMenuSubContent>
          </ContextMenuSub>,
        );
        break;
      case "item":
        nodes.push(
          <ContextMenuItem
            key={key}
            disabled={item.disabled}
            destructive={item.destructive}
            onSelect={() => handlers.get(item.id)?.()}
          >
            {item.label}
            {item.shortcut && <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>}
          </ContextMenuItem>,
        );
        break;
    }
  }
  return nodes;
}

/** Imperative opener for the app's one context menu. No-op without a provider. */
export function useContextMenu(): OpenContextMenu {
  return useContext(ContextMenuContext) ?? (() => {});
}
