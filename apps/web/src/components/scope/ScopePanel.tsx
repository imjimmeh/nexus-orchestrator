// apps/web/src/components/scope/ScopePanel.tsx
import { useNavigate } from "react-router-dom";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScopeContext } from "@/context/ScopeContext";
import { ScopeTree } from "./ScopeTree";

export function ScopePanel() {
  const { toggleScopePanel, activeScopeNodeId } = useScopeContext();
  const navigate = useNavigate();

  return (
    <aside className="fixed left-12 top-0 z-40 flex h-screen w-60 flex-col border-r border-border bg-card/95 backdrop-blur">
      <div className="flex h-16 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Scope
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={toggleScopePanel}
          aria-label="Close scope panel"
        >
          <X className="h-3.5 w-3.5" />
          <span className="sr-only">Close scope panel</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <ScopeTree />
      </div>

      <div className="border-t border-border p-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 text-xs"
          onClick={() => {
            navigate(`/scopes/${activeScopeNodeId}?tab=children`);
            toggleScopePanel();
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          New child scope
        </Button>
      </div>
    </aside>
  );
}
