// apps/web/src/components/scope/manage/RenameScopeDialog.tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateScopeNode } from "@/hooks/useScope";
import { useToast } from "@/hooks/useToast";
import type { ScopeNode } from "@/lib/api/client.scope.types";

export interface RenameScopeDialogProps {
  node: ScopeNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameScopeDialog({
  node,
  open,
  onOpenChange,
}: Readonly<RenameScopeDialogProps>) {
  const updateScopeNode = useUpdateScopeNode(node.id);
  const toast = useToast();
  const [name, setName] = useState(node.name);

  useEffect(() => {
    if (!open) return;
    setName(node.name);
  }, [open, node.name]);

  const trimmedName = name.trim();

  const handleSubmit = async () => {
    if (!trimmedName) return;
    try {
      await updateScopeNode.mutateAsync({ name: trimmedName });
      toast.success("Scope renamed", `${node.name} renamed to ${trimmedName}.`);
      onOpenChange(false);
    } catch {
      toast.error("Error", "Failed to rename scope.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {node.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label htmlFor="renameScopeName">Name</Label>
          <Input
            id="renameScopeName"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
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
            disabled={!trimmedName || updateScopeNode.isPending}
          >
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
