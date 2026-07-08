// apps/web/src/components/scope/manage/CreateChildDialog.tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAllowedChildTypes, useCreateScopeNode } from "@/hooks/useScope";
import { useToast } from "@/hooks/useToast";
import type { ScopeNode, ScopeNodeType } from "@/lib/api/client.scope.types";

/** Only an `org` node can be a tenant boundary, so the toggle is scoped to that type. */
const TENANT_ROOT_ELIGIBLE_TYPE: ScopeNodeType = "org";

export interface CreateChildDialogProps {
  parentNode: ScopeNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateChildDialog({
  parentNode,
  open,
  onOpenChange,
}: Readonly<CreateChildDialogProps>) {
  const { data: allowedTypes = [], isLoading } = useAllowedChildTypes(
    parentNode.id,
  );
  const createScope = useCreateScopeNode();
  const toast = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<ScopeNodeType | "">("");
  const [isTenantRoot, setIsTenantRoot] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setType("");
    setIsTenantRoot(false);
  }, [open]);

  const canAddChildren = allowedTypes.length > 0;

  const handleSubmit = async () => {
    if (!name || !type) return;
    try {
      await createScope.mutateAsync({
        parentId: parentNode.id,
        type,
        name,
        ...(type === TENANT_ROOT_ELIGIBLE_TYPE ? { isTenantRoot } : {}),
      });
      toast.success("Scope created", `${name} created.`);
      onOpenChange(false);
    } catch {
      toast.error("Error", "Failed to create scope.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Child Scope under {parentNode.name}</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <p className="text-sm text-muted-foreground">
            Loading allowed child types…
          </p>
        )}

        {!isLoading && !canAddChildren && (
          <p className="text-sm text-muted-foreground">
            {parentNode.name} cannot have child scopes.
          </p>
        )}

        {!isLoading && canAddChildren && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="childScopeName">Name</Label>
              <Input
                id="childScopeName"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                placeholder="e.g. Backend Team"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="childScopeType">Type</Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  setType(v as ScopeNodeType);
                }}
              >
                <SelectTrigger id="childScopeType">
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  {allowedTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {type === TENANT_ROOT_ELIGIBLE_TYPE && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="childScopeIsTenantRoot"
                  checked={isTenantRoot}
                  onCheckedChange={(checked) => {
                    setIsTenantRoot(checked === true);
                  }}
                />
                <Label htmlFor="childScopeIsTenantRoot">
                  Mark as tenant boundary
                </Label>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          {canAddChildren && (
            <Button
              onClick={() => {
                void handleSubmit();
              }}
              disabled={!name || !type || createScope.isPending}
            >
              Create
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
