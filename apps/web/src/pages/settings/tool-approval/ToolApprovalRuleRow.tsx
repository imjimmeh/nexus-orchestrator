import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToolApprovalRule, ToolApprovalRuleEffect } from "@/lib/api/tool-policy.types";

function effectBadgeVariant(
  effect: ToolApprovalRuleEffect,
): "default" | "secondary" | "destructive" | "outline" {
  if (effect === "deny") {
    return "destructive";
  }

  if (effect === "allow") {
    return "secondary";
  }

  return "default";
}

interface ToolApprovalRuleRowProps {
  rule: ToolApprovalRule;
  onEdit: (rule: ToolApprovalRule) => void;
  onDelete: (ruleId: string) => void;
  isDeleting: boolean;
}

export function ToolApprovalRuleRow({
  rule,
  onEdit,
  onDelete,
  isDeleting,
}: Readonly<ToolApprovalRuleRowProps>) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{rule.toolName}</span>
          <Badge variant={effectBadgeVariant(rule.effect)}>{rule.effect}</Badge>
          <Badge variant="outline">{rule.scopeType}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Scope ID: {rule.scopeId ?? "(global)"} | Priority: {rule.priority}
        </p>
        <p className="text-xs text-muted-foreground">
          Expires: {rule.expiresAt ?? "never"}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onEdit(rule);
          }}
        >
          Edit
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={isDeleting}
          onClick={() => {
            onDelete(rule.id);
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      </div>
    </div>
  );
}
