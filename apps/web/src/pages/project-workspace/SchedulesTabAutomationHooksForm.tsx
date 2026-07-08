import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AutomationHookActionType, AutomationHookTriggerType } from "@/lib/api/projects.types";
import {
  HOOK_ACTION_OPTIONS,
  HOOK_TRIGGER_OPTIONS,
  type AutomationHookFormState,
  type WorkflowOption,
} from "./SchedulesTabAutomationHooksCard.shared";

interface AutomationHookFormProps {
  readonly state: AutomationHookFormState;
  readonly workflows: WorkflowOption[];
  readonly onTriggerTypeChange: (value: AutomationHookTriggerType) => void;
  readonly onActionTypeChange: (value: AutomationHookActionType) => void;
  readonly onWorkflowIdChange: (value: string) => void;
  readonly onEventNameChange: (value: string) => void;
  readonly onPriorityTextChange: (value: string) => void;
  readonly onCooldownTextChange: (value: string) => void;
  readonly onEnabledChange: (value: boolean) => void;
  readonly onTriggerFilterTextChange: (value: string) => void;
  readonly onPayloadTextChange: (value: string) => void;
}

function AutomationHookForm({
  state,
  workflows,
  onTriggerTypeChange,
  onActionTypeChange,
  onWorkflowIdChange,
  onEventNameChange,
  onPriorityTextChange,
  onCooldownTextChange,
  onEnabledChange,
  onTriggerFilterTextChange,
  onPayloadTextChange,
}: Readonly<AutomationHookFormProps>) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="hook-trigger-type">Trigger</Label>
        <select
          id="hook-trigger-type"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={state.triggerType}
          onChange={(event) =>
            onTriggerTypeChange(event.target.value as AutomationHookTriggerType)
          }
        >
          {HOOK_TRIGGER_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="hook-action-type">Action</Label>
        <select
          id="hook-action-type"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={state.actionType}
          onChange={(event) =>
            onActionTypeChange(event.target.value as AutomationHookActionType)
          }
        >
          {HOOK_ACTION_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {state.actionType === "invoke_workflow" ? (
        <div className="space-y-2">
          <Label htmlFor="hook-workflow">Workflow</Label>
          <select
            id="hook-workflow"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={state.workflowId}
            onChange={(event) => onWorkflowIdChange(event.target.value)}
          >
            <option value="">Select workflow</option>
            {workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {state.actionType === "emit_event" ? (
        <div className="space-y-2">
          <Label htmlFor="hook-event-name">Event Name</Label>
          <Input
            id="hook-event-name"
            value={state.eventName}
            onChange={(event) => onEventNameChange(event.target.value)}
            placeholder="my.custom.event"
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="hook-priority">Priority</Label>
        <Input
          id="hook-priority"
          type="number"
          min={0}
          value={state.priorityText}
          onChange={(event) => onPriorityTextChange(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="hook-cooldown">Cooldown (seconds)</Label>
        <Input
          id="hook-cooldown"
          type="number"
          min={0}
          value={state.cooldownText}
          onChange={(event) => onCooldownTextChange(event.target.value)}
        />
      </div>

      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="hook-trigger-filter">
          Trigger Filter JSON (optional)
        </Label>
        <Textarea
          id="hook-trigger-filter"
          value={state.triggerFilterText}
          onChange={(event) => onTriggerFilterTextChange(event.target.value)}
          placeholder='{"to_status":"blocked"}'
          className="min-h-[90px] font-mono text-xs"
        />
      </div>

      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="hook-action-payload">
          Action Payload JSON (optional)
        </Label>
        <Textarea
          id="hook-action-payload"
          value={state.payloadText}
          onChange={(event) => onPayloadTextChange(event.target.value)}
          placeholder='{"reason":"automated escalation"}'
          className="min-h-[90px] font-mono text-xs"
        />
      </div>

      <div className="flex items-center gap-2 md:col-span-2">
        <input
          id="hook-enabled"
          type="checkbox"
          checked={state.enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        <Label htmlFor="hook-enabled">Enable hook immediately</Label>
      </div>
    </div>
  );
}

export { AutomationHookForm };
