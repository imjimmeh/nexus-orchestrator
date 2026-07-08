// apps/web/src/components/layout/Sidebar.tsx
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Globe, Hexagon, X } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useScopeContext } from "@/context/ScopeContext";
import { useAuthStore } from "@/stores/auth.store";
import { useEffectivePermissions } from "@/hooks/useEffectivePermissions";
import { resolvePlane } from "@/lib/scope/plane";
import {
  NAV_GROUPS,
  findNavItemByPath,
  filterNavGroupsByRole,
} from "./navigation.config";
import { useNavSidebar } from "./useNavSidebar";
import { getEffectiveNavExpanded } from "./layout-offset";
import { useActiveSessionCount } from "@/hooks/useActiveSessionCount";
import { useMobileNav } from "./MobileNavContext";

function useNavData() {
  const location = useLocation();
  const { user } = useAuthStore();
  const { activeScopeNodeId } = useScopeContext();
  const { permissions } = useEffectivePermissions();
  const activeItem = findNavItemByPath(location.pathname);
  const plane = resolvePlane(activeScopeNodeId);
  const navGroups = filterNavGroupsByRole(
    NAV_GROUPS,
    user?.roles.includes("admin") ?? false,
    plane,
    permissions,
  );
  return { activeItem, navGroups };
}

interface NavContentProps {
  expanded: boolean;
  onItemClick?: () => void;
}

function NavContent({ expanded, onItemClick }: Readonly<NavContentProps>) {
  const navigate = useNavigate();
  const { activeItem, navGroups } = useNavData();
  const { toggleScopePanel, isScopePanelOpen } = useScopeContext();
  const { toggleNav } = useNavSidebar();
  const activeSessionCount = useActiveSessionCount();
  const navItems = navGroups.flatMap((group) => group.items);

  return (
    <>
      {/* Logo + collapse/expand toggle */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-border",
          expanded ? "justify-between px-3" : "justify-center",
        )}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm">
          <Hexagon className="h-5 w-5 text-primary-foreground" />
        </div>
        {expanded && <span className="text-sm font-semibold">Nexus</span>}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleNav}
              aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
              aria-expanded={expanded}
              aria-controls="sidebar-nav"
            >
              {expanded ? (
                <ChevronLeft className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          {!expanded && (
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          )}
        </Tooltip>
      </div>

      {/* Scope toggle */}
      <div
        className={cn(
          "border-b border-border py-2",
          expanded ? "px-2" : "flex flex-col items-center gap-1",
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size={expanded ? "default" : "icon"}
              className={cn(
                expanded ? "w-full justify-start gap-2 h-9 px-2" : "h-8 w-8",
                isScopePanelOpen && "bg-accent text-accent-foreground",
              )}
              onClick={toggleScopePanel}
              aria-label="Scope tree"
            >
              <Globe className="h-4 w-4 shrink-0" />
              {expanded ? (
                <span className="text-sm">Scope tree</span>
              ) : (
                <span className="sr-only">Scope tree</span>
              )}
            </Button>
          </TooltipTrigger>
          {!expanded && (
            <TooltipContent side="right">Scope tree</TooltipContent>
          )}
        </Tooltip>
      </div>

      {/* Nav */}
      <nav
        id="sidebar-nav"
        aria-label="Main"
        className={cn(
          "flex flex-1 flex-col overflow-y-auto py-2",
          expanded ? "gap-2 px-2" : "items-center gap-1",
        )}
      >
        {expanded
          ? navGroups.map((group) => (
              <div key={group.title} className="flex flex-col gap-0.5">
                <span className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </span>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeItem?.path === item.path;
                  const isSessionsItem = item.path === "/sessions";
                  const showBadge = isSessionsItem && activeSessionCount > 0;
                  return (
                    <Button
                      key={item.path}
                      variant="ghost"
                      className={cn(
                        "w-full justify-start gap-2 h-9 px-2 text-sm transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => {
                        navigate(item.path);
                        onItemClick?.();
                      }}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                      {showBadge && (
                        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-success px-1 text-xs text-white">
                          {activeSessionCount}
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>
            ))
          : navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeItem?.path === item.path;
              const isSessionsItem = item.path === "/sessions";
              const showBadge = isSessionsItem && activeSessionCount > 0;
              return (
                <Tooltip key={item.path}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "relative h-8 w-8 transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      aria-label={item.label}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => {
                        navigate(item.path);
                        onItemClick?.();
                      }}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="sr-only">{item.label}</span>
                      {showBadge && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success text-[8px] text-white">
                          {activeSessionCount > 9 ? "9+" : activeSessionCount}
                        </span>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            })}
      </nav>
    </>
  );
}

export function Sidebar() {
  const { isScopePanelOpen } = useScopeContext();
  const { isNavExpanded } = useNavSidebar();
  const { mobileOpen, setMobileOpen } = useMobileNav();

  const expanded = getEffectiveNavExpanded(isNavExpanded, isScopePanelOpen);

  return (
    <TooltipProvider delayDuration={300}>
      <>
        {/* Desktop sidebar */}
        <aside
          aria-label="Main navigation"
          className={cn(
            "fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-border bg-card/95 backdrop-blur transition-all duration-200 md:flex",
            expanded ? "w-64" : "w-12",
          )}
        >
          <NavContent expanded={expanded} />
        </aside>

        {/* Mobile navigation overlay */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-50 flex md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div
              className="flex-1 bg-background/80 backdrop-blur-sm"
              onClick={() => {
                setMobileOpen(false);
              }}
            />
            <aside
              aria-label="Main navigation"
              className="flex h-screen w-64 flex-col border-l border-border bg-card/95 shadow-xl"
            >
              <div className="flex h-16 items-center justify-between border-b border-border px-3">
                <span className="text-sm font-semibold">Nexus</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Close navigation"
                  onClick={() => {
                    setMobileOpen(false);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <NavContent
                expanded
                onItemClick={() => {
                  setMobileOpen(false);
                }}
              />
            </aside>
          </div>
        )}
      </>
    </TooltipProvider>
  );
}
