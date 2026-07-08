import { ToolApprovalRule } from "@/lib/api/tool-policy.types";
import { ToolApprovalRuleRow } from "./ToolApprovalRuleRow";

interface ToolApprovalRulesListProps {
  isLoading: boolean;
  rules: ToolApprovalRule[];
  onEdit: (rule: ToolApprovalRule) => void;
  onDelete: (ruleId: string) => void;
  isDeletePending: boolean;
}

export function ToolApprovalRulesList({
  isLoading,
  rules,
  onEdit,
  onDelete,
  isDeletePending,
}: Readonly<ToolApprovalRulesListProps>) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading rules...</p>;
  }

  if (rules.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tool approval rules match the current filter.
      </p>
    );
  }

  return (
    <>
      {rules.map((rule) => (
        <ToolApprovalRuleRow
          key={rule.id}
          rule={rule}
          onEdit={onEdit}
          onDelete={onDelete}
          isDeleting={isDeletePending}
        />
      ))}
    </>
  );
}
