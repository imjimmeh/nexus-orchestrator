import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface KeyboardShortcutsContextValue {
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  isShortcutsHelpOpen: boolean;
  setShortcutsHelpOpen: (open: boolean) => void;
}

const KeyboardShortcutsContext =
  createContext<KeyboardShortcutsContextValue | null>(null);

function isMetaShortcut(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

function KeyBadge({ children }: Readonly<{ children: string }>) {
  return (
    <kbd className="inline-flex min-w-8 items-center justify-center rounded border border-border bg-muted px-2 py-1 text-xs font-semibold">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isShortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  const closeOverlays = useCallback(() => {
    setShortcutsHelpOpen(false);
    setCommandPaletteOpen(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeOverlays();
        return;
      }

      if (!isMetaShortcut(event)) {
        return;
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        setShortcutsHelpOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeOverlays]);

  const value = useMemo(
    () => ({
      isCommandPaletteOpen,
      setCommandPaletteOpen,
      isShortcutsHelpOpen,
      setShortcutsHelpOpen,
    }),
    [isCommandPaletteOpen, isShortcutsHelpOpen],
  );

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
      <Dialog open={isShortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span>Open command palette</span>
              <div className="flex items-center gap-1">
                <KeyBadge>Ctrl</KeyBadge>
                <span>+</span>
                <KeyBadge>K</KeyBadge>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Open shortcuts help</span>
              <div className="flex items-center gap-1">
                <KeyBadge>Ctrl</KeyBadge>
                <span>+</span>
                <KeyBadge>/</KeyBadge>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Close dialogs/panels</span>
              <KeyBadge>Esc</KeyBadge>
            </div>
            <p className="text-xs text-muted-foreground">
              On macOS, use Command instead of Control.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </KeyboardShortcutsContext.Provider>
  );
}

export function useKeyboardShortcuts() {
  const context = useContext(KeyboardShortcutsContext);
  if (!context) {
    throw new Error(
      "useKeyboardShortcuts must be used inside KeyboardShortcutsProvider",
    );
  }
  return context;
}
