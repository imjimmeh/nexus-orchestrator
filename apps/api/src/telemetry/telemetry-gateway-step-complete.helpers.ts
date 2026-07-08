import {
  AGENT_RESPONSE_EMPTY_SENTINEL,
  type AgentResponseStoreService,
} from '../redis/agent-response-store.service';
import type { WorkflowStepCompletionGuardService } from '../workflow/workflow-step-completion-guard.service';
import type { WorkflowRuntimeTerminalRunGuardService } from '../workflow/workflow-runtime/workflow-runtime-terminal-run-guard.service';
import { markSocketStepCompleted } from './telemetry-completed-step.helpers';
import { storeStepCompleteResponseCompat } from './telemetry-gateway-compat.helpers';
import type { AuthenticatedSocket, GatewayEventPayload } from './types';

type BroadcastEvent = (
  workflowRunId: string,
  event: { event_type: string; payload: Record<string, unknown> },
) => Promise<void>;

export async function handleStepCompleteGatewayCompat(params: {
  client: AuthenticatedSocket;
  payload: GatewayEventPayload;
  processAndBroadcastEvent: BroadcastEvent;
  agentResponseStore: AgentResponseStoreService;
  stepCompletionGuard?: Pick<
    WorkflowStepCompletionGuardService,
    'validateStepCompletion'
  >;
  terminalRunGuard?: Pick<
    WorkflowRuntimeTerminalRunGuardService,
    'assertRunIsActive'
  >;
}): Promise<void> {
  const {
    client,
    payload,
    processAndBroadcastEvent,
    agentResponseStore,
    stepCompletionGuard,
    terminalRunGuard,
  } = params;

  if (client.role !== 'agent' || !client.workflowRunId || !client.stepId) {
    return;
  }

  const workflowRunId = client.workflowRunId;
  const stepId = client.stepId;

  if (terminalRunGuard) {
    const denied = await denyTerminalStepCompleteIfNeeded({
      client,
      workflowRunId,
      stepId,
      payload,
      processAndBroadcastEvent,
      terminalRunGuard,
    });
    if (denied) {
      return;
    }
  }

  if (client.jobId && stepCompletionGuard) {
    const validation = await stepCompletionGuard.validateStepCompletion({
      workflowRunId,
      jobId: client.jobId,
    });

    if (!validation.allowed) {
      const error = validation.feedback ?? 'Step completion denied';

      await processAndBroadcastEvent(workflowRunId, {
        event_type: 'step_complete_denied',
        payload: {
          ...payload,
          error,
          missing_fields: validation.missing,
        },
      });

      client.emit('step_complete_result', {
        success: false,
        ok: false,
        error,
        missing_fields: validation.missing,
        remediation_prompt: validation.feedback,
      });
      return;
    }
  }

  await processAndBroadcastEvent(workflowRunId, {
    event_type: 'step_complete',
    payload,
  });

  await storeStepCompleteResponseCompat({
    workflowRunId,
    stepId,
    payload,
    agentResponseStore,
    emptySentinel: AGENT_RESPONSE_EMPTY_SENTINEL,
  });

  markSocketStepCompleted(client);

  client.emit('step_complete_result', {
    success: true,
    ok: true,
  });
}

async function denyTerminalStepCompleteIfNeeded(params: {
  client: AuthenticatedSocket;
  workflowRunId: string;
  stepId: string;
  payload: GatewayEventPayload;
  processAndBroadcastEvent: BroadcastEvent;
  terminalRunGuard: Pick<
    WorkflowRuntimeTerminalRunGuardService,
    'assertRunIsActive'
  >;
}): Promise<boolean> {
  try {
    await params.terminalRunGuard.assertRunIsActive(params.workflowRunId, {
      action: 'step_complete',
      jobId: params.client.jobId,
      stepId: params.stepId,
    });
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await params.processAndBroadcastEvent(params.workflowRunId, {
      event_type: 'step_complete_denied',
      payload: {
        ...params.payload,
        error: message,
        reason: 'terminal_workflow_run',
      },
    });
    params.client.emit('step_complete_result', {
      success: false,
      ok: false,
      error: message,
    });
    return true;
  }
}
