import { describe, expect, it, vi } from 'vitest';
import { handleTelemetryPostAuthConnection } from './telemetry-gateway-post-auth.helpers';
import { storeTelemetryAgentResponse } from './telemetry-gateway-turn-end-storage.helpers';

describe('telemetry-gateway extracted helpers', () => {
  it('configures agent clients and emits runtime ready for non-subagents', async () => {
    const join = vi.fn().mockResolvedValue(undefined);
    const emit = vi.fn();
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const getRunnerConfig = vi.fn().mockResolvedValue({ transport: 'socket' });

    await handleTelemetryPostAuthConnection({
      client: {
        workflowRunId: 'run-1',
        stepId: 'step-1',
        role: 'agent',
        isSubagent: false,
        containerId: 'container-1',
        join,
        emit,
      },
      processAndBroadcastEvent,
      getRunnerConfig,
      subscribeUiChannel: vi.fn().mockResolvedValue(undefined),
      getEventHistory: vi.fn().mockResolvedValue([]),
    });

    expect(join).toHaveBeenCalledWith('run-1');
    expect(getRunnerConfig).toHaveBeenCalledWith('run-1', 'step-1');
    expect(emit).toHaveBeenCalledWith('configure', { transport: 'socket' });
    expect(processAndBroadcastEvent).toHaveBeenCalledWith('run-1', {
      event_type: 'agent_runtime_ready',
      payload: {
        workflowRunId: 'run-1',
        stepId: 'step-1',
        containerId: 'container-1',
      },
    });
  });

  it('stores the best available agent response without lifecycle side effects', async () => {
    const storeResponse = vi.fn().mockResolvedValue(undefined);
    const storeStepComplete = vi.fn().mockResolvedValue(undefined);

    await storeTelemetryAgentResponse({
      client: {
        workflowRunId: 'run-2',
        stepId: 'step-2',
        isSubagent: true,
        subagentExecutionId: 'subagent-2',
      } as any,
      payload: {
        output: {
          errorMessage: 'planned failure',
        },
      },
      errorPrefix: 'ERROR: ',
      emptySentinel: '[empty]',
      storeResponse,
      storeStepComplete,
    });

    expect(storeResponse).toHaveBeenCalledWith(
      'run-2',
      'step-2',
      'ERROR: planned failure',
    );
    expect(storeStepComplete).toHaveBeenCalledWith(
      'run-2',
      'step-2',
      'ERROR: planned failure',
    );
  });
});
