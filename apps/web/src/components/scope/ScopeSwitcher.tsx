// apps/web/src/components/scope/ScopeSwitcher.tsx
import type React from "react";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScopeContext } from "@/context/ScopeContext";
import { resolvePlane } from "@/lib/scope/plane";

const GLOBAL_SCOPE_LABEL = "Platform (global)";
const BREADCRUMB_SEPARATOR = "›";

/**
 * Persistent header scope switcher. Always visible; shows the active scope
 * path as a breadcrumb, or the explicit "Platform (global)" label at the
 * global root. Clicking it opens the scope tree panel.
 */
export function ScopeSwitcher(): React.JSX.Element {
  const { activeScopeNodeId, activeScopePath, toggleScopePanel } =
    useScopeContext();
  const plane = resolvePlane(activeScopeNodeId);

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-auto rounded-full border-border/60 bg-accent/50 px-2.5 py-1 text-xs hover:bg-accent"
      onClick={toggleScopePanel}
    >
      <Globe className="h-3 w-3 text-muted-foreground" />
      {plane === "platform" ? (
        <span className="font-medium">{GLOBAL_SCOPE_LABEL}</span>
      ) : (
        <span className="flex items-center gap-1 font-medium">
          {activeScopePath.map((segment, index) => (
            <span
              key={`${segment}-${index}`}
              className="flex items-center gap-1"
            >
              {index > 0 && (
                <span aria-hidden="true" className="text-muted-foreground">
                  {BREADCRUMB_SEPARATOR}
                </span>
              )}
              <span>{segment}</span>
            </span>
          ))}
        </span>
      )}
    </Button>
  );
}
