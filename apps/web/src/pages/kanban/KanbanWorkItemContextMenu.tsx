import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { WorkItemStatus } from "@/lib/api/work-items.types";

interface MoveToOption {
  status: WorkItemStatus;
  label: string;
}

interface KanbanWorkItemContextMenuProps {
  open: boolean;
  cursorPosition: { x: number; y: number } | null;
  moveToOptions: MoveToOption[];
  canRetrigger: boolean;
  onMoveTo: (status: WorkItemStatus) => void;
  onRetrigger: () => void;
  onDelete: () => void;
  onClose: () => void;
  disabled?: boolean;
}

const MENU_WIDTH_PX = 176;
const SUBMENU_WIDTH_PX = 176;
const VIEWPORT_PADDING_PX = 8;
const MAX_MENU_HEIGHT_PX = 260;

export function KanbanWorkItemContextMenu({
  open,
  cursorPosition,
  moveToOptions,
  canRetrigger,
  onMoveTo,
  onRetrigger,
  onDelete,
  onClose,
  disabled = false,
}: Readonly<KanbanWorkItemContextMenuProps>) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleOutsideInteraction = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      onClose();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const handleViewportChange = () => {
      onClose();
    };

    document.addEventListener("pointerdown", handleOutsideInteraction);
    document.addEventListener("contextmenu", handleOutsideInteraction);
    globalThis.addEventListener("keydown", handleEscape);
    globalThis.addEventListener("resize", handleViewportChange);
    globalThis.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", handleOutsideInteraction);
      document.removeEventListener("contextmenu", handleOutsideInteraction);
      globalThis.removeEventListener("keydown", handleEscape);
      globalThis.removeEventListener("resize", handleViewportChange);
      globalThis.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [onClose, open]);

  const position = useMemo(() => {
    const browserWindow = globalThis.window;
    if (!cursorPosition || browserWindow === undefined) {
      return null;
    }

    const maxLeft =
      browserWindow.innerWidth -
      (MENU_WIDTH_PX + SUBMENU_WIDTH_PX + VIEWPORT_PADDING_PX * 2);
    const left = Math.min(
      Math.max(cursorPosition.x, VIEWPORT_PADDING_PX),
      Math.max(VIEWPORT_PADDING_PX, maxLeft),
    );

    const maxTop =
      browserWindow.innerHeight - (MAX_MENU_HEIGHT_PX + VIEWPORT_PADDING_PX);
    const top = Math.min(
      Math.max(cursorPosition.y, VIEWPORT_PADDING_PX),
      Math.max(VIEWPORT_PADDING_PX, maxTop),
    );

    return { left, top };
  }, [cursorPosition]);

  if (!open || !cursorPosition || !position) {
    return null;
  }

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      tabIndex={-1}
      className="fixed z-50 min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      <div className="group relative">
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
          disabled={disabled || moveToOptions.length === 0}
          aria-haspopup="menu"
        >
          <span>Move to</span>
          <span aria-hidden>▶</span>
        </button>

        <div
          role="menu"
          className="absolute left-full top-0 ml-1 hidden min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg group-hover:block group-focus-within:block"
        >
          {moveToOptions.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No allowed transitions
            </div>
          ) : (
            moveToOptions.map((option) => (
              <button
                key={option.status}
                type="button"
                role="menuitem"
                disabled={disabled}
                className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
                onClick={() => {
                  onMoveTo(option.status);
                  onClose();
                }}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      </div>

      {canRetrigger ? (
        <button
          type="button"
          role="menuitem"
          disabled={disabled}
          className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
          onClick={() => {
            onRetrigger();
            onClose();
          }}
        >
          Retrigger Execution
        </button>
      ) : null}

      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        className="block w-full rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-60"
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        Delete
      </button>
    </div>,
    document.body,
  );
}
