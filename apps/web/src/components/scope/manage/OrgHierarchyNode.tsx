// apps/web/src/components/scope/manage/OrgHierarchyNode.tsx
import { useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Globe,
  MapPin,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAllowedChildTypes } from "@/hooks/useScope";
import { TenantBoundaryToggle } from "./TenantBoundaryToggle";
import type { ScopeNode, ScopeNodeType } from "@/lib/api/client.scope.types";

/** Only project nodes may be archived (Phase 0: archival is a project-only lifecycle transition). */
const ARCHIVABLE_TYPE: ScopeNodeType = "project";

const TYPE_ICONS: Record<ScopeNodeType, React.ElementType> = {
  platform: Globe,
  org: Building2,
  region: MapPin,
  team: Users,
  project: FolderOpen,
};

export interface OrgHierarchyNodeProps {
  node: ScopeNode;
  depth: number;
  canCreate: boolean;
  canUpdate: boolean;
  canManage: boolean;
  onCreateChild: (node: ScopeNode) => void;
  onRename: (node: ScopeNode) => void;
  onMove: (node: ScopeNode) => void;
  onArchive: (node: ScopeNode) => void;
}

interface NodeActionsProps {
  node: ScopeNode;
  canCreateHere: boolean;
  canUpdate: boolean;
  canArchiveHere: boolean;
  onCreateChild: (node: ScopeNode) => void;
  onRename: (node: ScopeNode) => void;
  onMove: (node: ScopeNode) => void;
  onArchive: (node: ScopeNode) => void;
}

/** Per-node action controls — each hidden (not merely disabled) unless the caller's permission grants it. */
function NodeActions({
  node,
  canCreateHere,
  canUpdate,
  canArchiveHere,
  onCreateChild,
  onRename,
  onMove,
  onArchive,
}: Readonly<NodeActionsProps>) {
  return (
    <div className="flex items-center gap-1">
      {canUpdate && <TenantBoundaryToggle node={node} />}
      {canCreateHere && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onCreateChild(node);
          }}
        >
          Create child
        </Button>
      )}
      {canUpdate && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onRename(node);
          }}
        >
          Rename
        </Button>
      )}
      {canUpdate && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onMove(node);
          }}
        >
          Move
        </Button>
      )}
      {canArchiveHere && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onArchive(node);
          }}
        >
          Archive
        </Button>
      )}
    </div>
  );
}

export function OrgHierarchyNode({
  node,
  depth,
  canCreate,
  canUpdate,
  canManage,
  onCreateChild,
  onRename,
  onMove,
  onArchive,
}: Readonly<OrgHierarchyNodeProps>) {
  const [expanded, setExpanded] = useState(depth < 2);
  const { data: allowedChildTypes = [] } = useAllowedChildTypes(node.id);

  const hasChildren = (node.children?.length ?? 0) > 0;
  const canCreateHere = canCreate && allowedChildTypes.length > 0;
  const canArchiveHere = canManage && node.type === ARCHIVABLE_TYPE;
  const Icon = TYPE_ICONS[node.type] ?? FolderOpen;

  return (
    <div>
      <div
        className="group flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        <button
          type="button"
          className="flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={() => {
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
        <span className="flex-1 truncate font-medium">{node.name}</span>

        {node.isTenantRoot === true && (
          <Badge variant="secondary">Tenant</Badge>
        )}

        <NodeActions
          node={node}
          canCreateHere={canCreateHere}
          canUpdate={canUpdate}
          canArchiveHere={canArchiveHere}
          onCreateChild={onCreateChild}
          onRename={onRename}
          onMove={onMove}
          onArchive={onArchive}
        />
      </div>

      {expanded && hasChildren && (
        <div>
          {(node.children ?? []).map((child) => (
            <OrgHierarchyNode
              key={child.id}
              node={child}
              depth={depth + 1}
              canCreate={canCreate}
              canUpdate={canUpdate}
              canManage={canManage}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onMove={onMove}
              onArchive={onArchive}
            />
          ))}
        </div>
      )}
    </div>
  );
}
