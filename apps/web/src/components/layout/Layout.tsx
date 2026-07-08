import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { KeyboardShortcutsProvider } from "./KeyboardShortcutsProvider";
import { CommandPalette } from "./CommandPalette";
import { Breadcrumbs } from "./Breadcrumbs";
import { GlobalRealtimeProvider } from "../../context/GlobalRealtimeContext";
import { ScopeProvider, useScopeContext } from "../../context/ScopeContext";
import { ScopePanel } from "../scope/ScopePanel";
import { cn } from "@/lib/utils";
import { useNavSidebar } from "./useNavSidebar";
import { getContentOffsetClass } from "./layout-offset";
import { MobileNavProvider } from "./MobileNavContext";

function LayoutInner({ children }: { children: React.ReactNode }) {
  const { isScopePanelOpen } = useScopeContext();
  const { isNavExpanded } = useNavSidebar();

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      {isScopePanelOpen && <ScopePanel />}
      <div
        className={cn(
          "flex flex-1 flex-col min-w-0 transition-all duration-200",
          getContentOffsetClass(isNavExpanded, isScopePanelOpen),
        )}
      >
        <Header />
        <Breadcrumbs />
        <main className="flex-1 min-w-0 bg-muted/30 p-6 lg:p-8 h-full overflow-x-scroll">
          {children}
        </main>
      </div>
    </div>
  );
}

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <ScopeProvider>
      <GlobalRealtimeProvider>
        <KeyboardShortcutsProvider>
          <MobileNavProvider>
            <LayoutInner>{children}</LayoutInner>
            <CommandPalette />
          </MobileNavProvider>
        </KeyboardShortcutsProvider>
      </GlobalRealtimeProvider>
    </ScopeProvider>
  );
}
