import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToolApprovalRulesFilters } from "./tool-approval/ToolApprovalRulesFilters";
import { ToolApprovalRuleForm } from "./tool-approval/ToolApprovalRuleForm";
import { ToolApprovalRulesList } from "./tool-approval/ToolApprovalRulesList";
import { useToolApprovalRulesController } from "./tool-approval/useToolApprovalRulesController";

export function ToolApprovalRulesCard() {
  const controller = useToolApprovalRulesController();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool Approval Rules</CardTitle>
        <CardDescription>
          Manage dynamic tool governance overrides with full lifecycle controls.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ToolApprovalRulesFilters
          scopeFilter={controller.scopeFilter}
          onScopeFilterChange={controller.setScopeFilter}
          effectFilter={controller.effectFilter}
          onEffectFilterChange={controller.setEffectFilter}
        />

        <ToolApprovalRuleForm
          form={controller.form}
          onFormChange={controller.setForm}
          editingRuleId={controller.editingRuleId}
          isSaving={controller.isSaving}
          error={controller.error}
          onSubmit={() => {
            void controller.submitForm();
          }}
          onCancelEdit={controller.cancelEdit}
        />

        <div className="space-y-2">
          <ToolApprovalRulesList
            isLoading={controller.isLoading}
            rules={controller.sortedRules}
            onEdit={controller.startEditingRule}
            onDelete={(ruleId) => {
              void controller.deleteRule(ruleId);
            }}
            isDeletePending={controller.deleteMutation.isPending}
          />
        </div>
      </CardContent>
    </Card>
  );
}
