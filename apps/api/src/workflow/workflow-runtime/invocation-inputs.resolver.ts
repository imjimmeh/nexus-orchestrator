import { normalizeOptionalString } from '@nexus/core';
import { normalizeRecord } from './workflow-runtime-orchestration-actions.helpers';
import type { InvocationInputs } from './workflow-runtime-orchestration-actions-internal.types';
import type { InvokeAgentWorkflowParams } from './workflow-runtime-orchestration-actions.service.types';

const DEFAULT_AGENT_INVOCATION_WORKFLOW_ID =
  'orchestration_invoke_agent_default';

export function resolveInvocationInputs(
  params: InvokeAgentWorkflowParams,
): InvocationInputs {
  const workflowId =
    normalizeOptionalString(params.workflow_id) ??
    DEFAULT_AGENT_INVOCATION_WORKFLOW_ID;
  const agentProfile = normalizeOptionalString(params.agent_profile);
  const reason = normalizeOptionalString(params.reason);
  const reasoning = normalizeOptionalString(params.reasoning) ?? reason;
  const explicitTriggerData = normalizeRecord(params.trigger_data);
  const taskPrompt =
    normalizeOptionalString(params.task_prompt) ??
    normalizeOptionalString(explicitTriggerData.task_prompt);
  const message =
    normalizeOptionalString(explicitTriggerData.message) ??
    normalizeOptionalString(params.message);
  const objective =
    normalizeOptionalString(explicitTriggerData.objective) ??
    normalizeOptionalString(params.objective);

  return {
    agentProfile,
    explicitTriggerData,
    message,
    objective,
    reason,
    reasoning,
    taskPrompt,
    workflowId,
  };
}
