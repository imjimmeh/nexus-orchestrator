import { Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToolApprovalRuleEffect, ToolApprovalRuleScope } from "@/lib/api/tool-policy.types";
import type { RuleFormState } from "./toolApprovalRule.types";

interface ToolApprovalRuleFormProps {
  form: RuleFormState;
  onFormChange: (next: RuleFormState) => void;
  editingRuleId: string | null;
  isSaving: boolean;
  error: string | null;
  onSubmit: () => void;
  onCancelEdit: () => void;
}

export function ToolApprovalRuleForm({
  form,
  onFormChange,
  editingRuleId,
  isSaving,
  error,
  onSubmit,
  onCancelEdit,
}: Readonly<ToolApprovalRuleFormProps>) {
  return (
    <div className="grid gap-3 rounded-md border p-3 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="tool-rules-tool-name">Tool name</Label>
        <Input
          id="tool-rules-tool-name"
          value={form.toolName}
          onChange={(event) => {
            onFormChange({
              ...form,
              toolName: event.target.value,
            });
          }}
          placeholder="dispatch_start_work_items"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tool-rules-effect">Effect</Label>
        <select
          id="tool-rules-effect"
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={form.effect}
          onChange={(event) => {
            onFormChange({
              ...form,
              effect: event.target.value as ToolApprovalRuleEffect,
            });
          }}
        >
          <option value="allow">Allow</option>
          <option value="require_approval">Require Approval</option>
          <option value="deny">Deny</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="tool-rules-scope">Scope</Label>
        <select
          id="tool-rules-scope"
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={form.scopeType}
          onChange={(event) => {
            onFormChange({
              ...form,
              scopeType: event.target.value as ToolApprovalRuleScope,
            });
          }}
        >
          <option value="global">Global</option>
          <option value="project">Project</option>
          <option value="workflow">Workflow</option>
          <option value="session">Session</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="tool-rules-scope-id">Scope ID</Label>
        <Input
          id="tool-rules-scope-id"
          value={form.scopeId}
          onChange={(event) => {
            onFormChange({
              ...form,
              scopeId: event.target.value,
            });
          }}
          placeholder={
            form.scopeType === "global"
              ? "Optional for global"
              : "Required UUID"
          }
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tool-rules-priority">Priority</Label>
        <Input
          id="tool-rules-priority"
          type="number"
          value={form.priority}
          onChange={(event) => {
            onFormChange({
              ...form,
              priority: event.target.value,
            });
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tool-rules-expires">Expires at</Label>
        <Input
          id="tool-rules-expires"
          type="datetime-local"
          value={form.expiresAt}
          onChange={(event) => {
            onFormChange({
              ...form,
              expiresAt: event.target.value,
            });
          }}
        />
      </div>

      <div className="md:col-span-2 flex flex-wrap gap-2">
        <Button onClick={onSubmit} disabled={isSaving}>
          {editingRuleId ? (
            <Save className="mr-2 h-4 w-4" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          {editingRuleId ? "Save Rule" : "Create Rule"}
        </Button>
        {editingRuleId ? (
          <Button variant="outline" onClick={onCancelEdit}>
            Cancel Edit
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-destructive md:col-span-2">{error}</p>
      ) : null}
    </div>
  );
}
