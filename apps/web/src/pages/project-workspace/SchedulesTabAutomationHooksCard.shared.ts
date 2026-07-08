import { AutomationHookActionType, AutomationHookTriggerType } from "@/lib/api/projects.types";

interface WorkflowOption {
  id: string;
  name: string;
}

interface AutomationHookFormState {
  triggerType: AutomationHookTriggerType;
  actionType: AutomationHookActionType;
  workflowId: string;
  eventName: string;
  priorityText: string;
  cooldownText: string;
  enabled: boolean;
  triggerFilterText: string;
  payloadText: string;
}

const DEFAULT_TRIGGER_TYPE: AutomationHookTriggerType = "workflow.run.failed";
const DEFAULT_ACTION_TYPE: AutomationHookActionType = "invoke_workflow";

const HOOK_TRIGGER_OPTIONS: readonly AutomationHookTriggerType[] = [
  "workflow.run.started",
  "workflow.run.failed",
  "work_item.status.changed",
  "project.orchestration.completed",
];

const HOOK_ACTION_OPTIONS: readonly AutomationHookActionType[] = [
  "invoke_workflow",
  "emit_event",
  "record_metadata",
];

function buildInitialFormState(
  defaultWorkflowId: string,
): AutomationHookFormState {
  return {
    triggerType: DEFAULT_TRIGGER_TYPE,
    actionType: DEFAULT_ACTION_TYPE,
    workflowId: defaultWorkflowId,
    eventName: "",
    priorityText: "100",
    cooldownText: "0",
    enabled: true,
    triggerFilterText: "",
    payloadText: "",
  };
}

export {
  DEFAULT_ACTION_TYPE,
  DEFAULT_TRIGGER_TYPE,
  HOOK_ACTION_OPTIONS,
  HOOK_TRIGGER_OPTIONS,
  buildInitialFormState,
};
export type { AutomationHookFormState, WorkflowOption };
