// apps/web/src/components/scope/manage/MoveScopeDialog.tsx
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMoveScopeNode, useScopeTree } from "@/hooks/useScope";
import { useToast } from "@/hooks/useToast";
import type { ScopeNode } from "@/lib/api/client.scope.types";

interface ParentOption {
  id: string;
  label: string;
}

/** IDs of `node` itself and every descendant — these can never be a valid new parent (would create a cycle). */
function collectExcludedIds(node: ScopeNode): Set<string> {
  const ids = new Set<string>([node.id]);
  for (const child of node.children ?? []) {
    for (const id of collectExcludedIds(child)) {
      ids.add(id);
    }
  }
  return ids;
}

function findNodeById(root: ScopeNode, id: string): ScopeNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return undefined;
}

function flattenTree(
  node: ScopeNode,
  depth: number,
  excludedIds: ReadonlySet<string>,
): ParentOption[] {
  const self: ParentOption[] = excludedIds.has(node.id)
    ? []
    : [{ id: node.id, label: `${"  ".repeat(depth)}${node.name}` }];
  return [
    ...self,
    ...(node.children ?? []).flatMap((child) =>
      flattenTree(child, depth + 1, excludedIds),
    ),
  ];
}

export interface MoveScopeDialogProps {
  node: ScopeNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MoveScopeDialog({
  node,
  open,
  onOpenChange,
}: Readonly<MoveScopeDialogProps>) {
  const { data: tree } = useScopeTree();
  const moveScopeNode = useMoveScopeNode();
  const toast = useToast();
  const [newParentId, setNewParentId] = useState("");

  useEffect(() => {
    if (!open) return;
    setNewParentId("");
  }, [open]);

  const options = useMemo<ParentOption[]>(() => {
    if (!tree) return [];
    const subtreeRoot = findNodeById(tree, node.id) ?? node;
    const excludedIds = collectExcludedIds(subtreeRoot);
    return flattenTree(tree, 0, excludedIds);
  }, [tree, node]);

  const handleSubmit = async () => {
    if (!newParentId) return;
    try {
      await moveScopeNode.mutateAsync({ id: node.id, newParentId });
      toast.success("Scope moved", `${node.name} moved.`);
      onOpenChange(false);
    } catch {
      toast.error(
        "Error",
        "Failed to move scope. The target may be invalid (e.g. a cycle).",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move {node.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label htmlFor="moveScopeNewParent">New parent</Label>
          <Select value={newParentId} onValueChange={setNewParentId}>
            <SelectTrigger id="moveScopeNewParent">
              <SelectValue placeholder="Select new parent..." />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!newParentId || moveScopeNode.isPending}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
