// apps/web/src/components/scope/manage/OrgHierarchyManager.tsx
import { useMemo, useState } from "react";
import { useMyPermissions } from "@/hooks/useMyPermissions";
import { useArchiveScopeNode, useScopeTree } from "@/hooks/useScope";
import { useToast } from "@/hooks/useToast";
import { ArchiveScopeNodeDialog } from "./ArchiveScopeNodeDialog";
import { CreateChildDialog } from "./CreateChildDialog";
import { MoveScopeDialog } from "./MoveScopeDialog";
import { OrgHierarchyNode } from "./OrgHierarchyNode";
import { RenameScopeDialog } from "./RenameScopeDialog";
import type { ScopeNode } from "@/lib/api/client.scope.types";

type ActiveDialogKind = "createChild" | "rename" | "move" | "archive";

/** Finds the subtree node matching `id`, searching depth-first from `root`. */
function findSubtreeById(root: ScopeNode, id: string): ScopeNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findSubtreeById(child, id);
    if (found) return found;
  }
  return undefined;
}

interface ActiveScopeDialogsProps {
  activeDialog: ActiveDialogKind | null;
  activeNode: ScopeNode | null;
  onOpenChange: (open: boolean) => void;
  onConfirmArchive: (node: ScopeNode) => void;
}

/** Renders whichever scope-management dialog is currently active, if any. */
function ActiveScopeDialogs({
  activeDialog,
  activeNode,
  onOpenChange,
  onConfirmArchive,
}: Readonly<ActiveScopeDialogsProps>) {
  if (!activeNode || !activeDialog) return null;

  switch (activeDialog) {
    case "createChild":
      return (
        <CreateChildDialog
          parentNode={activeNode}
          open
          onOpenChange={onOpenChange}
        />
      );
    case "rename":
      return (
        <RenameScopeDialog node={activeNode} open onOpenChange={onOpenChange} />
      );
    case "move":
      return (
        <MoveScopeDialog node={activeNode} open onOpenChange={onOpenChange} />
      );
    case "archive":
      return (
        <ArchiveScopeNodeDialog
          node={activeNode}
          open
          onOpenChange={onOpenChange}
          onConfirm={onConfirmArchive}
        />
      );
    default:
      return null;
  }
}

export interface OrgHierarchyManagerProps {
  rootScopeNodeId: string;
}

export function OrgHierarchyManager({
  rootScopeNodeId,
}: Readonly<OrgHierarchyManagerProps>) {
  const { data: tree, isLoading: isTreeLoading, isError } = useScopeTree();
  const { can, isLoading: isPermissionsLoading } =
    useMyPermissions(rootScopeNodeId);
  const archiveScopeNode = useArchiveScopeNode();
  const toast = useToast();

  const [activeDialog, setActiveDialog] = useState<ActiveDialogKind | null>(
    null,
  );
  const [activeNode, setActiveNode] = useState<ScopeNode | null>(null);

  const subtreeRoot = useMemo(() => {
    if (!tree) return undefined;
    return findSubtreeById(tree, rootScopeNodeId);
  }, [tree, rootScopeNodeId]);

  const permissionsReady = !isPermissionsLoading;
  const canCreate = permissionsReady && can("scopes:create");
  const canUpdate = permissionsReady && can("scopes:update");
  const canManage = permissionsReady && can("scopes:manage");

  const openDialog = (kind: ActiveDialogKind, node: ScopeNode) => {
    setActiveNode(node);
    setActiveDialog(kind);
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (open) return;
    setActiveDialog(null);
    setActiveNode(null);
  };

  const handleArchive = async (node: ScopeNode) => {
    try {
      await archiveScopeNode.mutateAsync(node.id);
      toast.success("Scope archived", `${node.name} archived.`);
    } catch {
      toast.error("Error", "Failed to archive scope.");
    } finally {
      handleDialogOpenChange(false);
    }
  };

  if (isTreeLoading) {
    return (
      <p className="px-3 py-2 text-sm text-muted-foreground">Loading...</p>
    );
  }

  if (isError || !subtreeRoot) {
    return (
      <p className="px-3 py-2 text-sm text-destructive">
        Scope not found / no access.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <OrgHierarchyNode
        node={subtreeRoot}
        depth={0}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canManage={canManage}
        onCreateChild={(node) => {
          openDialog("createChild", node);
        }}
        onRename={(node) => {
          openDialog("rename", node);
        }}
        onMove={(node) => {
          openDialog("move", node);
        }}
        onArchive={(node) => {
          openDialog("archive", node);
        }}
      />

      <ActiveScopeDialogs
        activeDialog={activeDialog}
        activeNode={activeNode}
        onOpenChange={handleDialogOpenChange}
        onConfirmArchive={(node) => {
          void handleArchive(node);
        }}
      />
    </div>
  );
}
