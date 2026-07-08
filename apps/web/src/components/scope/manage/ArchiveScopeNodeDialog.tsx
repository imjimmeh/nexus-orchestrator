// apps/web/src/components/scope/manage/ArchiveScopeNodeDialog.tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ScopeNode } from "@/lib/api/client.scope.types";

export interface ArchiveScopeNodeDialogProps {
  node: ScopeNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (node: ScopeNode) => void;
}

/**
 * Standard (single-step) confirmation before archiving a scope node.
 * Archiving is reversible via restore, so this intentionally does not use
 * the destructive/type-to-confirm pattern reserved for permanent deletes
 * (e.g. `ProviderDeleteDialog`, `DeleteToolAlert`).
 */
export function ArchiveScopeNodeDialog({
  node,
  open,
  onOpenChange,
  onConfirm,
}: Readonly<ArchiveScopeNodeDialogProps>) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {node.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This hides &quot;{node.name}&quot; and its entire subtree. You can
            restore it later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm(node);
            }}
          >
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
