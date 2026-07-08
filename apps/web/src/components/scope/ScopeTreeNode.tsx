// apps/web/src/components/scope/ScopeTreeNode.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight,
  ChevronDown,
  Settings,
  Building2,
  Globe,
  MapPin,
  Users,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ScopeNode, ScopeNodeType } from "@/lib/api/client.scope.types";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";

const TYPE_ICONS: Record<ScopeNodeType, React.ElementType> = {
  platform: Globe,
  org: Building2,
  region: MapPin,
  team: Users,
  project: FolderOpen,
};

interface ScopeTreeNodeProps {
  node: ScopeNode;
  depth: number;
  activeScopeNodeId: string;
  onSelect: (node: ScopeNode, path: string[]) => void;
  ancestorPath: string[];
}

export function ScopeTreeNode({
  node,
  depth,
  activeScopeNodeId,
  onSelect,
  ancestorPath,
}: ScopeTreeNodeProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isActive = node.id === activeScopeNodeId;
  const Icon = TYPE_ICONS[node.type] ?? FolderOpen;
  const currentPath = [...ancestorPath, node.name];

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded px-1 py-0.5 text-sm cursor-pointer hover:bg-accent",
          isActive && "bg-accent/60 font-medium",
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => {
          onSelect(node, currentPath);
        }}
      >
        {/* Expand/collapse toggle */}
        <button
          className="flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded((v) => !v);
          }}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )
          ) : (
            <span className="h-3 w-3" />
          )}
        </button>

        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

        <span className="flex-1 truncate">{node.name}</span>

        {/* Active indicator */}
        {isActive && <span className="text-xs text-primary">◉</span>}

        {/* Settings gear — shown on hover, hidden for platform root */}
        {node.id !== GLOBAL_SCOPE_NODE_ID && (
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/scopes/${node.id}`);
            }}
          >
            <Settings className="h-3 w-3" />
            <span className="sr-only">Manage {node.name}</span>
          </Button>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {(node.children ?? []).map((child) => (
            <ScopeTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              activeScopeNodeId={activeScopeNodeId}
              onSelect={onSelect}
              ancestorPath={currentPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}
