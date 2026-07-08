import { ToolApprovalRuleEffect, ToolApprovalRuleScope } from "@/lib/api/tool-policy.types";

interface ToolApprovalRulesFiltersProps {
  scopeFilter: ToolApprovalRuleScope | "all";
  onScopeFilterChange: (scope: ToolApprovalRuleScope | "all") => void;
  effectFilter: ToolApprovalRuleEffect | "all";
  onEffectFilterChange: (effect: ToolApprovalRuleEffect | "all") => void;
}

export function ToolApprovalRulesFilters({
  scopeFilter,
  onScopeFilterChange,
  effectFilter,
  onEffectFilterChange,
}: Readonly<ToolApprovalRulesFiltersProps>) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-2">
        <label htmlFor="tool-rules-scope-filter">Scope filter</label>
        <select
          id="tool-rules-scope-filter"
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={scopeFilter}
          onChange={(event) => {
            onScopeFilterChange(
              event.target.value as ToolApprovalRuleScope | "all",
            );
          }}
        >
          <option value="all">All scopes</option>
          <option value="global">Global</option>
          <option value="project">Project</option>
          <option value="workflow">Workflow</option>
          <option value="session">Session</option>
        </select>
      </div>

      <div className="space-y-2">
        <label htmlFor="tool-rules-effect-filter">Effect filter</label>
        <select
          id="tool-rules-effect-filter"
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={effectFilter}
          onChange={(event) => {
            onEffectFilterChange(
              event.target.value as ToolApprovalRuleEffect | "all",
            );
          }}
        >
          <option value="all">All effects</option>
          <option value="allow">Allow</option>
          <option value="require_approval">Require Approval</option>
          <option value="deny">Deny</option>
        </select>
      </div>
    </div>
  );
}
