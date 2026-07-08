import { describe, expect, it, vi } from 'vitest';
import type { EventLedgerService } from '../observability/event-ledger.service';
import {
  broadcastAgentEnd,
  broadcastAgentError,
  broadcastAgentTelemetry,
  broadcastToolExecutionLifecycle,
  broadcastTurnEnd,
  broadcastUserQuestionsPosed,
} from './telemetry-event-broadcaster.helpers';
import type { AuthenticatedSocket, GatewayEventPayload } from './types';

/**
 * Tests for the event-broadcaster helpers. Each helper is exercised in
 * isolation against mocked `processAndBroadcastEvent` and
 * `eventLedger.emitBestEffort` dependencies — no public handler, no
 * runtime gateway wiring. Behavioural parity with the prior inline calls
 * inside `telemetry-gateway-runtime.helpers.ts` is the contract under test.
 */

type BroadcastEvent = (
  workflowRunId: string,
  event: { event_type: string; payload: Record<string, unknown> },
) => Promise<void>;
type BroadcastEventMock = BroadcastEvent & ReturnType<typeof vi.fn>;
type EventLedgerMock = Pick<EventLedgerService, 'emitBestEffort'> & {
  emitBestEffort: ReturnType<typeof vi.fn>;
};

const baseClient: AuthenticatedSocket = {
  workflowRunId: 'run-1',
  jobId: 'job-1',
  stepId: 'step-1',
} as unknown as AuthenticatedSocket;

function makeProcessAndBroadcastEvent(): BroadcastEventMock {
  return vi.fn().mockResolvedValue(undefined);
}

function makeEventLedger(): EventLedgerMock {
  return {
    emitBestEffort: vi.fn().mockResolvedValue(undefined),
  };
}

describe('broadcastAgentTelemetry', () => {
  it('emits the agent_telemetry event with the enriched payload', async () => {
    const processAndBroadcastEvent = makeProcessAndBroadcastEvent();
    const enrichedPayload: GatewayEventPayload = {
      agentName: 'strategist',
      message: 'thinking...',
    };

    await broadcastAgentTelemetry({
      client: baseClient,
      payload: { message: 'thinking...' },
      enrichedPayload,
      processAndBroadcastEvent,
      streamId: 'run-1',
    });

    expect(processAndBroadcastEvent).toHaveBeenCalledTimes(1);
    expect(processAndBroadcastEvent).toHaveBeenCalledWith('run-1', {
      event_type: 'agent_telemetry',
      payload: enrichedPayload,
    });
  });

  it('uses the supplied streamId as the broadcast target', async () => {
    const processAndBroadcastEvent = makeProcessAndBroadcastEvent();

    await broadcastAgentTelemetry({
      client: baseClient,
      payload: {},
      enrichedPayload: { token: 'hi' },
      processAndBroadcastEvent,
      streamId: 'subagent-stream',
    });

    expect(processAndBroadcastEvent).toHaveBeenCalledWith(
      'subagent-stream',
      expect.objectContaining({ event_type: 'agent_telemetry' }),
    );
  });
});

describe('broadcastToolExecutionLifecycle', () => {
  it('on tool_execution_start, broadcasts and emits tool.execution.started with in_progress', async () => {
    const processAndBroadcastEvent = makeProcessAndBroadcastEvent();
    const eventLedger = makeEventLedger();
    const payload: GatewayEventPayload = { toolName: 'bash' };

    await broadcastToolExecutionLifecycle({
      client: baseClient,
      payload,
      payloadWithSessionTree: { ...payload, session_tree_id: 'tree-1' },
      sessionTreeId: 'tree-1',
      eventType: 'tool_execution_start',
      streamId: 'run-1',
      processAndBroadcastEvent,
      eventLedger,
    });

    expect(processAndBroadcastEvent).toHaveBeenCalledWith('run-1', {
      event_type: 'tool_execution_start',
      payload: { ...payload, session_tree_id: 'tree-1' },
    });
    expect(eventLedger.emitBestEffort).toHaveBeenCalledTimes(1);
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'tool.execution.started',
        outcome: 'in_progress',
        workflowRunId: 'run-1',
        sessionTreeId: 'tree-1',
        stepId: 'step-1',
        jobId: 'job-1',
        payload: expect.objectContaining({
          toolName: 'bash',
          session_tree_id: 'tree-1',
        }),
      }),
    );
  });

  it('on tool_execution_end with hasFailure, emits tool.execution.completed with outcome=failure and the supplied errorMessage', async () => {
    const processAndBroadcastEvent = makeProcessAndBroadcastEvent();
    const eventLedger = makeEventLedger();
    const payload: GatewayEventPayload = { toolName: 'bash' };

    await broadcastToolExecutionLifecycle({
      client: baseClient,
      payload,
      payloadWithSessionTree: payload,
      sessionTreeId: undefined,
      eventType: 'tool_execution_end',
      streamId: 'run-1',
      processAndBroadcastEvent,
      eventLedger,
      hasFailure: true,
      errorMessage: 'Work item not found',
    });

    expect(processAndBroadcastEvent).toHaveBeenCalledWith('run-1', {
      event_type: 'tool_execution_end',
      payload,
    });
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'tool.execution.completed',
        outcome: 'failure',
        errorMessage: 'Work item not found',
      }),
    );
  });

  it('on tool_execution_end with hasFailure=false, emits tool.execution.completed with outcome=success and no errorMessage', async () => {
    const processAndBroadcastEvent = makeProcessAndBroadcastEvent();
    const eventLedger = makeEventLedger();

    await broadcastToolExecutionLifecycle({
      client: baseClient,
      payload: { toolName: 'bash' },
      payloadWithSessionTree: { toolName: 'bash' },
      sessionTreeId: undefined,
      eventType: 'tool_execution_end',
      streamId: 'run-1',
      processAndBroadcastEvent,
      eventLedger,
      hasFailure: false,
    });

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'tool.execution.completed',
        outcome: 'success',
      }),
    );

    const emitCall = eventLedger.emitBestEffort.mock.calls[0]?.[0] as
      | { errorMessage?: string }
      | undefined;
    expect(emitCall?.errorMessage).toBeUndefined();
  });

  it('on tool_execution_update, emits tool.execution.updated with outcome=in_progress regardless of hasFailure', async () => {
    const processAndBroadcastEvent = makeProcessAndBroadcastEvent();
    const eventLedger = makeEventLedger();

    await broadcastToolExecutionLifecycle({
      client: baseClient,
      payload: { toolName: 'bash', isError: true },
      payloadWithSessionTree: { toolName: 'bash', isError: true },
      sessionTreeId: undefined,
      eventType: 'tool_execution_update',
      streamId: 'run-1',
      processAndBroadcastEvent,
      eventLedger,
      hasFailure: true,
      errorMessage: 'ignored',
    });

    expect(processAndBroadcastEvent).toHaveBeenCalledWith('run-1', {
      event_type: 'tool_execution_update',
      payload: { toolName: 'bash', isError: true },
    });
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'tool.execution.updated',
        outcome: 'in_progress',
      }),
    );
  });
});

describe('broadcastTurnEnd', () => {
  it('with no errorMessage, emits turn_end and workflow.turn.completed with outcome=success', async () => {
    const processAndBroadcastEvent = makeProcessAndBroadcastEvent();
    const eventLedger = makeEventLedger();
    const payload: GatewayEventPayload = {
      output: { ok: true, response: 'done' },
    };

    await broadcastTurnEnd({
      client: baseClient,
      payloadWithSessionTree: payload,
      sessionTreeId: undefined,
      streamId: 'run-1',
      processAndBroadcastEvent,
      eventLedger,
      errorMessage: undefined,
    });

    expect(processAndBroadcastEvent).toHaveBeenCalledWith('run-1', {
      event_type: 'turn_end',
      payload,
    });
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.turn.completed',
        outcome: 'success',
        workflowRunId: 'run-1',
        stepId: 'step-1',
        actorType: 'agent',
      }),
    );
    const emitCall = eventLedger.emitBestEffort.mock.calls[0]?.[0] as
      | { errorMessage?: string }
      | undefined;
    expect(emitCall?.errorMessage).toBeUndefined();
  });

  it('with an errorMessage, emits workflow.turn.completed with outcome=failure and forwards the error', async () => {
    const processAndBroadcastEvent = makeProcessAndBroadcastEvent();
    const eventLedger = makeEventLedger();
    const payload: GatewayEventPayload = {
      output: { ok: false, errorMessage: 'Provider quota exceeded' },
    };

    await broadcastTurnEnd({
      client: baseClient,
      payloadWithSessionTree: payload,
      sessionTreeId: undefined,
      streamId: 'run-1',
      processAndBroadcastEvent,
      eventLedger,
      errorMessage: 'Provider quota exceeded',
    });

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.turn.completed',
        outcome: 'failure',
        errorMessage: 'Provider quota exceeded',
      }),
    );
  });

  it('forwards sessionTreeId into the ledger row when present', async () => {
    const eventLedger = makeEventLedger();

    await broadcastTurnEnd({
      client: baseClient,
      payloadWithSessionTree: { session_tree_id: 'tree-1' },
      sessionTreeId: 'tree-1',
      streamId: 'run-1',
      processAndBroadcastEvent: makeProcessAndBroadcastEvent(),
      eventLedger,
      errorMessage: undefined,
    });

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionTreeId: 'tree-1',
        payload: expect.objectContaining({ session_tree_id: 'tree-1' }),
      }),
    );
  });
});

describe('broadcastAgentEnd', () => {
  it('emits agent_end and workflow.agent.completed with outcome=success and no errorMessage when hasFailure=false', async () => {
    const processAndBroadcastEvent = makeProcessAndBroadcastEvent();
    const eventLedger = makeEventLedger();
    const payload: GatewayEventPayload = {
      output: { ok: true, response: 'done' },
    };

    await broadcastAgentEnd({
      client: baseClient,
      enrichedPayload: payload,
      processAndBroadcastEvent,
      eventLedger,
      hasFailure: false,
      failureContext: undefined,
    });

    expect(processAndBroadcastEvent).toHaveBeenCalledWith('run-1', {
      event_type: 'agent_end',
      payload,
    });
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.agent.completed',
        outcome: 'success',
        workflowRunId: 'run-1',
        stepId: 'step-1',
        actorType: 'agent',
      }),
    );
    const emitCall = eventLedger.emitBestEffort.mock.calls[0]?.[0] as
      | { errorMessage?: string }
      | undefined;
    expect(emitCall?.errorMessage).toBeUndefined();
  });

  it('emits workflow.agent.completed with outcome=failure and forwards failureContext when hasFailure=true', async () => {
    const processAndBroadcastEvent = makeProcessAndBroadcastEvent();
    const eventLedger = makeEventLedger();

    await broadcastAgentEnd({
      client: baseClient,
      enrichedPayload: {
        output: { ok: false, errorMessage: 'Provider failed' },
      },
      processAndBroadcastEvent,
      eventLedger,
      hasFailure: true,
      failureContext: 'Provider failed',
    });

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.agent.completed',
        outcome: 'failure',
        errorMessage: 'Provider failed',
      }),
    );
  });

  it('does not persist errorMessage when hasFailure=true but failureContext is undefined', async () => {
    const processAndBroadcastEvent = makeProcessAndBroadcastEvent();
    const eventLedger = makeEventLedger();

    await broadcastAgentEnd({
      client: baseClient,
      enrichedPayload: {},
      processAndBroadcastEvent,
      eventLedger,
      hasFailure: true,
      failureContext: undefined,
    });

    const emitCall = eventLedger.emitBestEffort.mock.calls[0]?.[0] as
      | { errorMessage?: string }
      | undefined;
    expect(emitCall?.errorMessage).toBeUndefined();
  });
});

describe('broadcastAgentError', () => {
  it('emits agent_error and writes no ledger row', async () => {
    const processAndBroadcastEvent = makeProcessAndBroadcastEvent();
    const eventLedger = makeEventLedger();
    const payload: GatewayEventPayload = { error: 'engine blew up' };

    await broadcastAgentError({
      client: baseClient,
      payload,
      processAndBroadcastEvent,
    });

    expect(processAndBroadcastEvent).toHaveBeenCalledWith('run-1', {
      event_type: 'agent_error',
      payload,
    });
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
  });
});

describe('broadcastUserQuestionsPosed', () => {
  it('emits user_questions_posed and writes no ledger row', async () => {
    const processAndBroadcastEvent = makeProcessAndBroadcastEvent();
    const eventLedger = makeEventLedger();
    const payload = {
      questions: [{ text: 'Confirm?' }, { text: 'Continue?' }],
    };

    await broadcastUserQuestionsPosed({
      client: baseClient,
      payload,
      processAndBroadcastEvent,
    });

    expect(processAndBroadcastEvent).toHaveBeenCalledWith('run-1', {
      event_type: 'user_questions_posed',
      payload,
    });
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
  });

  it('forwards the questions array verbatim, preserving order', async () => {
    const processAndBroadcastEvent = makeProcessAndBroadcastEvent();
    const questions = [
      { text: 'first', idx: 0 },
      { text: 'second', idx: 1 },
    ];

    await broadcastUserQuestionsPosed({
      client: baseClient,
      payload: { questions },
      processAndBroadcastEvent,
    });

    const call = processAndBroadcastEvent.mock.calls[0]?.[1] as
      | { payload: { questions: typeof questions } }
      | undefined;
    expect(call?.payload.questions).toEqual(questions);
  });
});
