// apps/web/src/components/scope/manage/TenantBoundaryToggle.tsx
import { Switch } from "@/components/ui/switch";
import { useUpdateScopeNode } from "@/hooks/useScope";
import { useToast } from "@/hooks/useToast";
import type { ScopeNode, ScopeNodeType } from "@/lib/api/client.scope.types";

/** Only these node types may be marked as a tenant boundary. */
const TENANT_ROOT_ELIGIBLE_TYPES: ReadonlySet<ScopeNodeType> = new Set([
  "org",
  "platform",
]);

export interface TenantBoundaryToggleProps {
  node: ScopeNode;
  disabled?: boolean;
}

export function TenantBoundaryToggle({
  node,
  disabled,
}: Readonly<TenantBoundaryToggleProps>) {
  const updateScopeNode = useUpdateScopeNode(node.id);
  const toast = useToast();

  if (!TENANT_ROOT_ELIGIBLE_TYPES.has(node.type)) {
    return null;
  }

  const handleCheckedChange = async (next: boolean) => {
    try {
      await updateScopeNode.mutateAsync({ isTenantRoot: next });
    } catch {
      toast.error("Error", "Failed to update tenant boundary.");
    }
  };

  return (
    <Switch
      checked={node.isTenantRoot ?? false}
      disabled={disabled || updateScopeNode.isPending}
      onCheckedChange={(next) => {
        void handleCheckedChange(next);
      }}
    />
  );
}
