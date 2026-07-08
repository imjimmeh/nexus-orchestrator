// apps/web/src/components/layout/Header.tsx
import { Bell, User, Command, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useKeyboardShortcuts } from "./KeyboardShortcutsProvider";
import { ScopeSwitcher } from "@/components/scope/ScopeSwitcher";
import { useMobileNav } from "./MobileNavContext";

export function Header() {
  const { setCommandPaletteOpen, setShortcutsHelpOpen } =
    useKeyboardShortcuts();
  const { setMobileOpen } = useMobileNav();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/50 bg-card/80 px-6 backdrop-blur">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden h-8 w-8"
          aria-label="Open navigation"
          onClick={() => {
            setMobileOpen(true);
          }}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">Nexus</h1>
        <ScopeSwitcher />
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          className="hidden h-9 w-56 justify-between text-muted-foreground md:inline-flex"
          onClick={() => {
            setCommandPaletteOpen(true);
          }}
        >
          <span className="flex items-center gap-2">
            <Command className="h-3.5 w-3.5" />
            <span>Search</span>
          </span>
          <span className="rounded border px-1.5 py-0.5 text-[10px]">
            Ctrl+K
          </span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          onClick={() => {
            setShortcutsHelpOpen(true);
          }}
          aria-label="Keyboard shortcuts"
        >
          <span className="text-xs font-medium">Ctrl+/</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          <span className="sr-only">Notifications</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          aria-label="User menu"
        >
          <User className="h-5 w-5" />
          <span className="sr-only">User menu</span>
        </Button>
      </div>
    </header>
  );
}
