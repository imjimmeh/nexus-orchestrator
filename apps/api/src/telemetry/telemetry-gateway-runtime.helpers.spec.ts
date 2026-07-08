import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  handleAgentEndGatewayCompat,
  handleAgentTelemetryGatewayCompat,
  handleStepCompleteGatewayCompat,
  handleToolExecutionStartGatewayCompat,
  handleToolExecutionEndGatewayCompat,
  handleTurnEndGatewayCompat,
  handleUserQuestionsPosedGatewayCompat,
} from './telemetry-gateway-runtime.helpers';
import {
  hasPendingAsyncDispatch,
  registerAsyncDispatch,
  resolveAsyncDispatch,
} from '../workflow/workflow-step-execution/async-dispatch-registry';

describe('telemetry-gateway-runtime.helpers', () => {
  it('records a workflow run heartbeat on agent telemetry so the stale-run watchdog sees liveness', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const runHeartbeat = { recordActivity: vi.fn() };

    await handleAgentTelemetryGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-main',
        stepId: 'step-main',
      },
      payload: { message: 'thinking' },
      processAndBroadcastEvent,
      runHeartbeat,
    });

    expect(runHeartbeat.recordActivity).toHaveBeenCalledWith('run-main');
  });

  it('suppresses tool telemetry emitted after the same socket completed its step', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const agentResponseStore = {
      storeStepComplete: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      role: 'agent',
      workflowRunId: 'run-1',
      jobId: 'job-1',
      stepId: 'implement',
      emit: vi.fn(),
    };

    await handleStepCompleteGatewayCompat({
      client: client as never,
      payload: { summary: 'done' },
      processAndBroadcastEvent,
      agentResponseStore: agentResponseStore as never,
    });
    processAndBroadcastEvent.mockClear();

    await handleToolExecutionStartGatewayCompat({
      client: client as never,
      payload: { toolName: 'manage_todo_list' },
      processAndBroadcastEvent,
      eventLedger,
    });

    expect(processAndBroadcastEvent).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
  });

  it('suppresses turn_end telemetry emitted after the same socket completed its step', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const agentResponseStore = {
      store: vi.fn().mockResolvedValue(undefined),
      storeStepComplete: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      role: 'agent',
      workflowRunId: 'run-1',
      jobId: 'job-1',
      stepId: 'implement',
      emit: vi.fn(),
    };

    await handleStepCompleteGatewayCompat({
      client: client as never,
      payload: { summary: 'done' },
      processAndBroadcastEvent,
      agentResponseStore: agentResponseStore as never,
    });
    processAndBroadcastEvent.mockClear();

    await handleTurnEndGatewayCompat({
      client: client as never,
      payload: { output: { ok: true, response: 'late commit-step turn' } },
      processAndBroadcastEvent,
      eventLedger,
      agentResponseStore: agentResponseStore as never,
    });

    expect(processAndBroadcastEvent).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).not.toHaveBeenCalled();
    expect(agentResponseStore.store).not.toHaveBeenCalled();
  });

  it('records a workflow run heartbeat on turn_end for main and subagent sockets', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const agentResponseStore = {
      store: vi.fn().mockResolvedValue(undefined),
      storeStepComplete: vi.fn().mockResolvedValue(undefined),
    };
    const runHeartbeat = { recordActivity: vi.fn() };

    await handleTurnEndGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-subagent',
        stepId: 'step-subagent',
        isSubagent: true,
        subagentExecutionId: 'subagent-exec-1',
      },
      payload: {
        stepId: 'step-subagent',
        output: { ok: true, response: 'progress' },
      },
      processAndBroadcastEvent,
      eventLedger,
      agentResponseStore: agentResponseStore as never,
      runHeartbeat,
    });

    expect(runHeartbeat.recordActivity).toHaveBeenCalledWith('run-subagent');
  });

  it('stores, broadcasts, and records tool-use turn_end without completion side effects', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const agentResponseStore = {
      store: vi.fn().mockResolvedValue(undefined),
      storeStepComplete: vi.fn().mockResolvedValue(undefined),
    };
    await handleTurnEndGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-subagent',
        stepId: 'step-subagent',
        isSubagent: true,
        subagentExecutionId: 'subagent-exec-1',
      },
      payload: {
        stepId: 'step-subagent',
        output: {
          ok: true,
          response: 'partial progress before tool execution',
          stopReason: 'toolUse',
        },
      },
      processAndBroadcastEvent,
      eventLedger,
      agentResponseStore: agentResponseStore as never,
    });

    expect(processAndBroadcastEvent).toHaveBeenCalledWith('run-subagent', {
      event_type: 'turn_end',
      payload: expect.objectContaining({
        stepId: 'step-subagent',
        output: expect.objectContaining({ stopReason: 'toolUse' }),
      }),
    });
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.turn.completed',
        outcome: 'success',
        workflowRunId: 'run-subagent',
      }),
    );
    expect(agentResponseStore.store).toHaveBeenCalledWith(
      'run-subagent',
      'step-subagent',
      'partial progress before tool execution',
    );
    expect(agentResponseStore.storeStepComplete).not.toHaveBeenCalled();
  });

  it('completes subagent executions from agent_end', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const agentResponseStore = {
      store: vi.fn().mockResolvedValue(undefined),
      storeStepComplete: vi.fn().mockResolvedValue(undefined),
    };
    const subagentOrchestrator = {
      handleCompletion: vi.fn().mockResolvedValue(undefined),
    };
    const payload = {
      stepId: 'step-subagent',
      output: { ok: true, response: 'final answer' },
    };

    await handleAgentEndGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-subagent',
        stepId: 'step-subagent',
        isSubagent: true,
        subagentExecutionId: 'subagent-exec-1',
      } as never,
      payload,
      processAndBroadcastEvent,
      eventLedger,
      agentResponseStore: agentResponseStore as never,
      subagentOrchestrator,
    });

    expect(subagentOrchestrator.handleCompletion).toHaveBeenCalledWith(
      'subagent-exec-1',
      payload,
      'run-subagent',
    );
  });

  it('stores and broadcasts agent_end for non-subagent agents without subagent completion', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const agentResponseStore = {
      store: vi.fn().mockResolvedValue(undefined),
      storeStepComplete: vi.fn().mockResolvedValue(undefined),
    };
    const subagentOrchestrator = {
      handleCompletion: vi.fn().mockResolvedValue(undefined),
    };

    await handleAgentEndGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-main',
        stepId: 'step-main',
      } as never,
      payload: {
        stepId: 'step-main',
        output: { ok: true, response: 'final answer' },
      },
      processAndBroadcastEvent,
      eventLedger,
      agentResponseStore: agentResponseStore as never,
      subagentOrchestrator,
    });

    expect(processAndBroadcastEvent).toHaveBeenCalledWith('run-main', {
      event_type: 'agent_end',
      payload: {
        stepId: 'step-main',
        output: { ok: true, response: 'final answer' },
      },
    });
    expect(agentResponseStore.store).toHaveBeenCalledWith(
      'run-main',
      'step-main',
      'final answer',
    );
    expect(subagentOrchestrator.handleCompletion).not.toHaveBeenCalled();
  });

  it('records failed agent_end ledger rows when output has errorMessage', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const agentResponseStore = {
      store: vi.fn().mockResolvedValue(undefined),
      storeStepComplete: vi.fn().mockResolvedValue(undefined),
    };
    const subagentOrchestrator = {
      handleCompletion: vi.fn().mockResolvedValue(undefined),
    };

    await handleAgentEndGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-failed',
        stepId: 'step-failed',
      } as never,
      payload: {
        stepId: 'step-failed',
        output: { ok: false, errorMessage: 'Provider failed' },
      },
      processAndBroadcastEvent,
      eventLedger,
      agentResponseStore: agentResponseStore as never,
      subagentOrchestrator,
    });

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.agent.completed',
        outcome: 'failure',
        errorMessage: 'Provider failed',
      }),
    );
  });

  it('records failed agent_end ledger rows when output is aborted without errorMessage', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const agentResponseStore = {
      store: vi.fn().mockResolvedValue(undefined),
      storeStepComplete: vi.fn().mockResolvedValue(undefined),
    };
    const subagentOrchestrator = {
      handleCompletion: vi.fn().mockResolvedValue(undefined),
    };

    await handleAgentEndGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-aborted',
        stepId: 'step-aborted',
      } as never,
      payload: {
        stepId: 'step-aborted',
        output: { ok: false, stopReason: 'aborted' },
      },
      processAndBroadcastEvent,
      eventLedger,
      agentResponseStore: agentResponseStore as never,
      subagentOrchestrator,
    });

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.agent.completed',
        outcome: 'failure',
        errorMessage: 'aborted',
      }),
    );
  });

  it('records failed agent_end ledger rows with fallback context when output ok is false', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const agentResponseStore = {
      store: vi.fn().mockResolvedValue(undefined),
      storeStepComplete: vi.fn().mockResolvedValue(undefined),
    };
    const subagentOrchestrator = {
      handleCompletion: vi.fn().mockResolvedValue(undefined),
    };

    await handleAgentEndGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-failed-without-context',
        stepId: 'step-failed-without-context',
      } as never,
      payload: {
        stepId: 'step-failed-without-context',
        output: { ok: false },
      },
      processAndBroadcastEvent,
      eventLedger,
      agentResponseStore: agentResponseStore as never,
      subagentOrchestrator,
    });

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.agent.completed',
        outcome: 'failure',
        errorMessage: 'Agent reported failure',
      }),
    );
  });

  it('extracts nested details.data.error as failure reason', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };

    await handleToolExecutionEndGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-1',
        jobId: 'job-1',
        stepId: 'step-1',
      },
      payload: {
        result: {
          details: {
            ok: false,
            data: {
              error: 'Work item not found',
            },
          },
        },
      },
      processAndBroadcastEvent,
      eventLedger,
    });

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: 'Work item not found',
      }),
    );
  });

  it('extracts result content text when details are missing', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };

    await handleToolExecutionEndGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-2',
        jobId: 'job-2',
        stepId: 'step-2',
      },
      payload: {
        isError: true,
        result: {
          content: [
            {
              type: 'text',
              text: 'EISDIR: illegal operation on a directory, read',
            },
          ],
        },
      },
      processAndBroadcastEvent,
      eventLedger,
    });

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: 'EISDIR: illegal operation on a directory, read',
      }),
    );
  });

  it('checkpoints session on ordinary tool completion and links session tree id', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const persistSessionCheckpoint = vi
      .fn()
      .mockResolvedValue('session-tree-123');

    await handleToolExecutionEndGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-3',
        jobId: 'job-3',
        stepId: 'step-3',
        containerId: 'container-3',
      },
      payload: {
        toolName: 'bash',
        result: {
          details: {
            ok: true,
          },
        },
      },
      processAndBroadcastEvent,
      eventLedger,
      persistSessionCheckpoint,
    });

    expect(persistSessionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-3',
        containerId: 'container-3',
        eventType: 'tool_execution_end',
      }),
    );

    expect(processAndBroadcastEvent).toHaveBeenCalledWith(
      'run-3',
      expect.objectContaining({
        event_type: 'tool_execution_end',
        payload: expect.objectContaining({
          session_tree_id: 'session-tree-123',
        }),
      }),
    );

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionTreeId: 'session-tree-123',
        payload: expect.objectContaining({
          session_tree_id: 'session-tree-123',
        }),
      }),
    );
  });

  it('checkpoints session on ordinary tool start', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const persistSessionCheckpoint = vi
      .fn()
      .mockResolvedValue('session-tree-start');

    await handleToolExecutionStartGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-tool-start',
        jobId: 'job-tool-start',
        stepId: 'step-tool-start',
        containerId: 'container-tool-start',
      },
      payload: {
        toolName: 'bash',
      },
      processAndBroadcastEvent,
      eventLedger,
      persistSessionCheckpoint,
    });

    expect(persistSessionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-tool-start',
        containerId: 'container-tool-start',
        eventType: 'tool_execution_start',
      }),
    );
    expect(processAndBroadcastEvent).toHaveBeenCalledWith(
      'run-tool-start',
      expect.objectContaining({
        event_type: 'tool_execution_start',
        payload: expect.objectContaining({
          session_tree_id: 'session-tree-start',
        }),
      }),
    );
  });

  it('checkpoints session on assistant message completion', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const agentResponseStore = {
      store: vi.fn().mockResolvedValue(undefined),
      storeStepComplete: vi.fn().mockResolvedValue(undefined),
    };
    const persistSessionCheckpoint = vi
      .fn()
      .mockResolvedValue('session-tree-turn');

    await handleTurnEndGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-turn',
        stepId: 'step-turn',
        containerId: 'container-turn',
      },
      payload: {
        output: {
          ok: true,
          response: 'assistant message',
          stopReason: 'stop',
        },
      },
      processAndBroadcastEvent,
      eventLedger,
      agentResponseStore,
      persistSessionCheckpoint,
    } as never);

    expect(persistSessionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-turn',
        containerId: 'container-turn',
        eventType: 'turn_end',
      }),
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionTreeId: 'session-tree-turn',
        payload: expect.objectContaining({
          session_tree_id: 'session-tree-turn',
        }),
      }),
    );
  });

  it('resolves subagent checkpoint containers with the real workflow run id', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const persistSessionCheckpoint = vi
      .fn()
      .mockResolvedValue('session-tree-subagent');
    const resolveContainerContext = vi
      .fn()
      .mockResolvedValue('container-subagent');

    await handleToolExecutionEndGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'parent-run',
        streamId: 'chat-session',
        chatSessionId: 'chat-session',
        jobId: 'subagent-exec',
        stepId: 'subagent-exec',
        isSubagent: true,
        subagentExecutionId: 'subagent-exec',
      },
      payload: {
        toolName: 'bash',
      },
      processAndBroadcastEvent,
      eventLedger,
      persistSessionCheckpoint,
      resolveContainerContext,
    });

    expect(resolveContainerContext).toHaveBeenCalledWith({
      workflowRunId: 'parent-run',
      jobId: 'subagent-exec',
      stepId: 'subagent-exec',
    });
    expect(persistSessionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'parent-run',
        containerId: 'container-subagent',
        chatSessionId: 'chat-session',
        eventType: 'tool_execution_end',
        subagentExecutionId: 'subagent-exec',
      }),
    );
    expect(processAndBroadcastEvent).toHaveBeenCalledWith(
      'chat-session',
      expect.any(Object),
    );
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'parent-run',
      }),
    );
  });

  it('resolves missing container context before checkpointing', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const persistSessionCheckpoint = vi
      .fn()
      .mockResolvedValue('session-tree-456');
    const resolveContainerContext = vi
      .fn()
      .mockResolvedValue('container-recovered');
    const client = {
      role: 'agent',
      workflowRunId: 'run-4',
      jobId: 'job-4',
      stepId: 'step-4',
      containerId: undefined,
    };

    await handleToolExecutionEndGatewayCompat({
      client: client,
      payload: {
        toolName: 'ask_user_questions',
        result: {
          details: {
            ok: true,
          },
        },
      },
      processAndBroadcastEvent,
      eventLedger,
      persistSessionCheckpoint,
      resolveContainerContext,
    });

    expect(resolveContainerContext).toHaveBeenCalledWith({
      workflowRunId: 'run-4',
      jobId: 'job-4',
      stepId: 'step-4',
    });
    expect(persistSessionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-4',
        containerId: 'container-recovered',
        eventType: 'tool_execution_end',
      }),
    );
    expect(client.containerId).toBe('container-recovered');
  });

  it('passes chatSessionId to checkpoint persistence when available', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const persistSessionCheckpoint = vi
      .fn()
      .mockResolvedValue('session-tree-chat-1');

    await handleToolExecutionEndGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-7',
        jobId: 'job-7',
        stepId: 'step-7',
        containerId: 'container-7',
        chatSessionId: 'chat-session-7',
      },
      payload: {
        toolName: 'ask_user_questions',
      },
      processAndBroadcastEvent,
      eventLedger,
      persistSessionCheckpoint,
    });

    expect(persistSessionCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-7',
        containerId: 'container-7',
        chatSessionId: 'chat-session-7',
        eventType: 'tool_execution_end',
      }),
    );
  });

  it('skips checkpoint when container context cannot be resolved', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const persistSessionCheckpoint = vi.fn().mockResolvedValue(undefined);
    const resolveContainerContext = vi.fn().mockResolvedValue(null);

    await handleToolExecutionEndGatewayCompat({
      client: {
        role: 'agent',
        workflowRunId: 'run-5',
        jobId: 'job-5',
        stepId: 'step-5',
      },
      payload: {
        toolName: 'ask_user_questions',
      },
      processAndBroadcastEvent,
      eventLedger,
      persistSessionCheckpoint,
      resolveContainerContext,
    });

    expect(persistSessionCheckpoint).not.toHaveBeenCalled();
  });

  it('denies socket step completion when the workflow run is terminal', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const agentResponseStore = {
      storeStepComplete: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      role: 'agent',
      workflowRunId: 'run-6',
      jobId: 'job-6',
      stepId: 'step-6',
      emit: vi.fn(),
    };
    const terminalRunGuard = {
      assertRunIsActive: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'Workflow run run-6 has terminal status FAILED; step_complete is not allowed',
          ),
        ),
    };

    await handleStepCompleteGatewayCompat({
      client: client as never,
      payload: { summary: 'late' },
      processAndBroadcastEvent,
      agentResponseStore: agentResponseStore as never,
      terminalRunGuard,
    });

    expect(processAndBroadcastEvent).toHaveBeenCalledWith(
      'run-6',
      expect.objectContaining({
        event_type: 'step_complete_denied',
        payload: expect.objectContaining({ reason: 'terminal_workflow_run' }),
      }),
    );
    expect(agentResponseStore.storeStepComplete).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('step_complete_result', {
      success: false,
      ok: false,
      error:
        'Workflow run run-6 has terminal status FAILED; step_complete is not allowed',
    });
  });

  it('denies step completion when required outputs are missing', async () => {
    const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
    const agentResponseStore = {
      storeStepComplete: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      role: 'agent',
      workflowRunId: 'run-6',
      jobId: 'job-6',
      stepId: 'step-6',
      emit: vi.fn(),
    };
    const stepCompletionGuard = {
      validateStepCompletion: vi.fn().mockResolvedValue({
        allowed: false,
        missing: ['artifacts'],
        feedback: 'Use set_job_output with artifacts.',
      }),
    };

    await handleStepCompleteGatewayCompat({
      client: client as never,
      payload: { summary: 'done' },
      processAndBroadcastEvent,
      agentResponseStore: agentResponseStore as never,
      stepCompletionGuard,
    });

    expect(stepCompletionGuard.validateStepCompletion).toHaveBeenCalledWith({
      workflowRunId: 'run-6',
      jobId: 'job-6',
    });
    expect(processAndBroadcastEvent).toHaveBeenCalledWith(
      'run-6',
      expect.objectContaining({
        event_type: 'step_complete_denied',
        payload: expect.objectContaining({
          missing_fields: ['artifacts'],
        }),
      }),
    );
    expect(agentResponseStore.storeStepComplete).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('step_complete_result', {
      success: false,
      ok: false,
      error: 'Use set_job_output with artifacts.',
      missing_fields: ['artifacts'],
      remediation_prompt: 'Use set_job_output with artifacts.',
    });
  });

  describe('per-turn usage recording', () => {
    const makeStores = () => ({
      processAndBroadcastEvent: vi.fn().mockResolvedValue(undefined),
      eventLedger: { emitBestEffort: vi.fn().mockResolvedValue(undefined) },
      agentResponseStore: {
        store: vi.fn().mockResolvedValue(undefined),
        storeStepComplete: vi.fn().mockResolvedValue(undefined),
      },
    });

    it('records the turn_end usage as a workflow_run budget event', async () => {
      const stores = makeStores();
      const turnUsageRecorder = {
        recordTurnUsage: vi.fn().mockResolvedValue(undefined),
      };

      await handleTurnEndGatewayCompat({
        client: {
          role: 'agent',
          workflowRunId: 'run-7',
          stepId: 'session',
          scopeId: 'scope-7',
          providerName: 'deepseek',
          modelName: 'deepseek-v4-pro',
        },
        payload: {
          output: {
            ok: true,
            usage: { input: 692, output: 110, totalTokens: 3746 },
          },
        },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
        turnUsageRecorder,
      });

      expect(turnUsageRecorder.recordTurnUsage).toHaveBeenCalledWith({
        contextType: 'workflow_run',
        contextId: 'run-7',
        scopeId: 'scope-7',
        providerName: 'deepseek',
        modelName: 'deepseek-v4-pro',
        stepId: 'session',
        usage: { input: 692, output: 110, totalTokens: 3746 },
      });
    });

    it('tags chat-session turns with the chat context type', async () => {
      const stores = makeStores();
      const turnUsageRecorder = {
        recordTurnUsage: vi.fn().mockResolvedValue(undefined),
      };

      await handleTurnEndGatewayCompat({
        client: {
          role: 'agent',
          workflowRunId: 'chat-9',
          chatSessionId: 'chat-9',
          providerName: 'deepseek',
          modelName: 'deepseek-v4-pro',
        },
        payload: { output: { ok: true, usage: { input: 5, output: 2 } } },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
        turnUsageRecorder,
      });

      expect(turnUsageRecorder.recordTurnUsage).toHaveBeenCalledWith(
        expect.objectContaining({ contextType: 'chat', contextId: 'chat-9' }),
      );
    });

    it('skips recording when the turn carries no usage object', async () => {
      const stores = makeStores();
      const turnUsageRecorder = {
        recordTurnUsage: vi.fn().mockResolvedValue(undefined),
      };

      await handleAgentEndGatewayCompat({
        client: {
          role: 'agent',
          workflowRunId: 'run-7',
          providerName: 'deepseek',
          modelName: 'deepseek-v4-pro',
        } as never,
        payload: { output: { ok: true, stopReason: 'end_turn' } },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
        subagentOrchestrator: { handleCompletion: vi.fn() },
        turnUsageRecorder,
      });

      expect(turnUsageRecorder.recordTurnUsage).not.toHaveBeenCalled();
    });

    it('records usage when usage is at the top level of the payload rather than nested in output', async () => {
      const stores = makeStores();
      const turnUsageRecorder = {
        recordTurnUsage: vi.fn().mockResolvedValue(undefined),
      };

      await handleTurnEndGatewayCompat({
        client: {
          role: 'agent',
          workflowRunId: 'run-top-level-usage',
          stepId: 'step-1',
          scopeId: 'scope-1',
          providerName: 'anthropic',
          modelName: 'claude-sonnet-4-6',
        },
        payload: {
          output: { ok: true, stopReason: 'end_turn' },
          usage: { input: 100, output: 50 },
        },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
        turnUsageRecorder,
      });

      expect(turnUsageRecorder.recordTurnUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          contextId: 'run-top-level-usage',
          usage: { input: 100, output: 50 },
        }),
      );
    });
  });

  describe('signalAsyncDispatchIfPending', () => {
    function makeAgentEndParams(
      workflowRunId: string,
      stepId: string,
      outputOverrides: Record<string, unknown> = {},
    ) {
      return {
        client: {
          role: 'agent',
          workflowRunId,
          stepId,
        } as never,
        payload: {
          stepId,
          output: { ok: true, response: 'done', ...outputOverrides },
        },
        processAndBroadcastEvent: vi.fn().mockResolvedValue(undefined),
        eventLedger: { emitBestEffort: vi.fn().mockResolvedValue(undefined) },
        agentResponseStore: {
          store: vi.fn().mockResolvedValue(undefined),
          storeStepComplete: vi.fn().mockResolvedValue(undefined),
        } as never,
        subagentOrchestrator: { handleCompletion: vi.fn() },
      };
    }

    afterEach(() => {
      // Clean up any leftover pending dispatches to avoid cross-test leakage.
      resolveAsyncDispatch('run-async-success', 'step-async-success');
      resolveAsyncDispatch('run-async-failure', 'step-async-failure');
    });

    it('resolves a pending async dispatch on successful agent_end', async () => {
      const workflowRunId = 'run-async-success';
      const stepId = 'step-async-success';

      const dispatchPromise = registerAsyncDispatch(workflowRunId, stepId);
      expect(hasPendingAsyncDispatch(workflowRunId, stepId)).toBe(true);

      const params = makeAgentEndParams(workflowRunId, stepId);
      await handleAgentEndGatewayCompat(params);

      await expect(dispatchPromise).resolves.toBeUndefined();
      expect(hasPendingAsyncDispatch(workflowRunId, stepId)).toBe(false);
    });

    it('rejects a pending async dispatch when hasTerminalAgentFailure is true', async () => {
      const workflowRunId = 'run-async-failure';
      const stepId = 'step-async-failure';

      const dispatchPromise = registerAsyncDispatch(workflowRunId, stepId);
      expect(hasPendingAsyncDispatch(workflowRunId, stepId)).toBe(true);

      const params = makeAgentEndParams(workflowRunId, stepId, {
        ok: false,
        errorMessage: 'Provider quota exceeded',
      });
      await handleAgentEndGatewayCompat(params);

      await expect(dispatchPromise).rejects.toThrow('Provider quota exceeded');
      expect(hasPendingAsyncDispatch(workflowRunId, stepId)).toBe(false);
    });

    it('completes without error when there is no pending async dispatch for the step', async () => {
      const workflowRunId = 'run-no-dispatch';
      const stepId = 'step-no-dispatch';

      expect(hasPendingAsyncDispatch(workflowRunId, stepId)).toBe(false);

      const params = makeAgentEndParams(workflowRunId, stepId);
      await expect(
        handleAgentEndGatewayCompat(params),
      ).resolves.toBeUndefined();
    });
  });

  describe('agent.completed reflects the final turn outcome', () => {
    function makeAgentEndStores() {
      return {
        processAndBroadcastEvent: vi.fn().mockResolvedValue(undefined),
        eventLedger: { emitBestEffort: vi.fn().mockResolvedValue(undefined) },
        agentResponseStore: {
          store: vi.fn().mockResolvedValue(undefined),
          storeStepComplete: vi.fn().mockResolvedValue(undefined),
        },
        subagentOrchestrator: { handleCompletion: vi.fn() },
      };
    }

    function findAgentCompleted(eventLedger: {
      emitBestEffort: ReturnType<typeof vi.fn>;
    }) {
      return eventLedger.emitBestEffort.mock.calls
        .map((call) => call[0])
        .find((event) => event.eventName === 'workflow.agent.completed');
    }

    it('marks agent.completed as failure when the last turn errored even if agent_end reports ok:true', async () => {
      const stores = makeAgentEndStores();
      const client = {
        role: 'agent',
        workflowRunId: 'run-fail',
        stepId: 'strategize',
      } as never;

      await handleTurnEndGatewayCompat({
        client,
        payload: {
          output: {
            ok: false,
            stopReason: 'error',
            errorMessage: '402 Insufficient Balance',
          },
        },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
      });

      await handleAgentEndGatewayCompat({
        client,
        payload: { output: { ok: true, response: '', stopReason: 'end_turn' } },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
        subagentOrchestrator: stores.subagentOrchestrator,
      });

      const agentCompleted = findAgentCompleted(stores.eventLedger);
      expect(agentCompleted?.outcome).toBe('failure');
      expect(agentCompleted?.errorMessage).toContain('402');
    });

    it('keeps agent.completed success when the last turn succeeded', async () => {
      const stores = makeAgentEndStores();
      const client = {
        role: 'agent',
        workflowRunId: 'run-ok',
        stepId: 'strategize',
      } as never;

      await handleTurnEndGatewayCompat({
        client,
        payload: {
          output: { ok: true, response: 'done', stopReason: 'end_turn' },
        },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
      });

      await handleAgentEndGatewayCompat({
        client,
        payload: {
          output: { ok: true, response: 'done', stopReason: 'end_turn' },
        },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
        subagentOrchestrator: stores.subagentOrchestrator,
      });

      expect(findAgentCompleted(stores.eventLedger)?.outcome).toBe('success');
    });

    it('treats agent.completed as success when a failed turn was followed by a successful turn', async () => {
      const stores = makeAgentEndStores();
      const client = {
        role: 'agent',
        workflowRunId: 'run-recovered',
        stepId: 'strategize',
      } as never;

      await handleTurnEndGatewayCompat({
        client,
        payload: {
          output: {
            ok: false,
            stopReason: 'error',
            errorMessage: '429 too many requests',
          },
        },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
      });

      await handleTurnEndGatewayCompat({
        client,
        payload: {
          output: { ok: true, response: 'recovered', stopReason: 'end_turn' },
        },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
      });

      await handleAgentEndGatewayCompat({
        client,
        payload: {
          output: { ok: true, response: 'recovered', stopReason: 'end_turn' },
        },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
        subagentOrchestrator: stores.subagentOrchestrator,
      });

      expect(findAgentCompleted(stores.eventLedger)?.outcome).toBe('success');
    });
  });

  describe('durable parent step finalizer on agent_end', () => {
    function makeBaseStores() {
      return {
        processAndBroadcastEvent: vi.fn().mockResolvedValue(undefined),
        eventLedger: { emitBestEffort: vi.fn().mockResolvedValue(undefined) },
        agentResponseStore: {
          store: vi.fn().mockResolvedValue(undefined),
          storeStepComplete: vi.fn().mockResolvedValue(undefined),
        },
        subagentOrchestrator: { handleCompletion: vi.fn() },
      };
    }

    it('calls finalizeFromAgentEnd for non-subagent agents and does not call handleCompletion', async () => {
      const stores = makeBaseStores();
      const stepCompletionFinalizer = {
        finalizeFromAgentEnd: vi
          .fn()
          .mockResolvedValue({ finalized: true, executionId: 'exec-1' }),
      };

      await handleAgentEndGatewayCompat({
        client: {
          role: 'agent',
          workflowRunId: 'run-parent',
          jobId: 'job-parent',
          stepId: 'step-parent',
          isSubagent: false,
        } as never,
        payload: { output: { ok: true, response: 'done' } },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
        subagentOrchestrator: stores.subagentOrchestrator,
        stepCompletionFinalizer,
      });

      expect(
        stepCompletionFinalizer.finalizeFromAgentEnd,
      ).toHaveBeenCalledOnce();
      expect(stepCompletionFinalizer.finalizeFromAgentEnd).toHaveBeenCalledWith(
        {
          workflowRunId: 'run-parent',
          contextId: 'job-parent',
          hasFailure: false,
          failureMessage: undefined,
        },
      );
      expect(
        stores.subagentOrchestrator.handleCompletion,
      ).not.toHaveBeenCalled();
    });

    it('does not call finalizeFromAgentEnd for subagent agents', async () => {
      const stores = makeBaseStores();
      const stepCompletionFinalizer = {
        finalizeFromAgentEnd: vi.fn().mockResolvedValue({ finalized: false }),
      };

      await handleAgentEndGatewayCompat({
        client: {
          role: 'agent',
          workflowRunId: 'run-subagent',
          jobId: 'job-subagent',
          stepId: 'step-subagent',
          isSubagent: true,
          subagentExecutionId: 'subagent-exec-99',
        } as never,
        payload: { output: { ok: true, response: 'done' } },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
        subagentOrchestrator: stores.subagentOrchestrator,
        stepCompletionFinalizer,
      });

      expect(
        stepCompletionFinalizer.finalizeFromAgentEnd,
      ).not.toHaveBeenCalled();
      expect(
        stores.subagentOrchestrator.handleCompletion,
      ).toHaveBeenCalledOnce();
      expect(stores.subagentOrchestrator.handleCompletion).toHaveBeenCalledWith(
        'subagent-exec-99',
        expect.anything(),
        'run-subagent',
      );
    });

    it('calls neither path for a subagent with a missing subagentExecutionId', async () => {
      const stores = makeBaseStores();
      const stepCompletionFinalizer = {
        finalizeFromAgentEnd: vi.fn().mockResolvedValue({ finalized: false }),
      };

      await handleAgentEndGatewayCompat({
        client: {
          role: 'agent',
          workflowRunId: 'run-subagent-no-exec',
          jobId: 'job-subagent-no-exec',
          stepId: 'step-subagent-no-exec',
          isSubagent: true,
          subagentExecutionId: undefined,
        } as never,
        payload: { output: { ok: true, response: 'done' } },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
        subagentOrchestrator: stores.subagentOrchestrator,
        stepCompletionFinalizer,
      });

      expect(
        stores.subagentOrchestrator.handleCompletion,
      ).not.toHaveBeenCalled();
      expect(
        stepCompletionFinalizer.finalizeFromAgentEnd,
      ).not.toHaveBeenCalled();
    });

    it('falls back to stepId as contextId when jobId is absent', async () => {
      const stores = makeBaseStores();
      const stepCompletionFinalizer = {
        finalizeFromAgentEnd: vi.fn().mockResolvedValue({ finalized: true }),
      };

      await handleAgentEndGatewayCompat({
        client: {
          role: 'agent',
          workflowRunId: 'run-no-jobid',
          stepId: 'step-no-jobid',
          isSubagent: false,
        } as never,
        payload: { output: { ok: true, response: 'done' } },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
        subagentOrchestrator: stores.subagentOrchestrator,
        stepCompletionFinalizer,
      });

      expect(stepCompletionFinalizer.finalizeFromAgentEnd).toHaveBeenCalledWith(
        expect.objectContaining({ contextId: 'step-no-jobid' }),
      );
    });

    it('is an early-exit no-op when the client has no workflowRunId', async () => {
      const stores = makeBaseStores();
      const stepCompletionFinalizer = {
        finalizeFromAgentEnd: vi.fn().mockResolvedValue({ finalized: false }),
      };

      await handleAgentEndGatewayCompat({
        client: {
          role: 'agent',
          jobId: 'job-orphan',
          stepId: 'step-orphan',
          isSubagent: false,
        } as never,
        payload: { output: { ok: true, response: 'done' } },
        processAndBroadcastEvent: stores.processAndBroadcastEvent,
        eventLedger: stores.eventLedger,
        agentResponseStore: stores.agentResponseStore as never,
        subagentOrchestrator: stores.subagentOrchestrator,
        stepCompletionFinalizer,
      });

      expect(stores.processAndBroadcastEvent).not.toHaveBeenCalled();
      expect(
        stepCompletionFinalizer.finalizeFromAgentEnd,
      ).not.toHaveBeenCalled();
    });

    it('does not propagate errors thrown by finalizeFromAgentEnd', async () => {
      const stores = makeBaseStores();
      const stepCompletionFinalizer = {
        finalizeFromAgentEnd: vi
          .fn()
          .mockRejectedValue(new Error('DB connection lost')),
      };

      await expect(
        handleAgentEndGatewayCompat({
          client: {
            role: 'agent',
            workflowRunId: 'run-finalize-err',
            jobId: 'job-finalize-err',
            stepId: 'step-finalize-err',
            isSubagent: false,
          } as never,
          payload: { output: { ok: true, response: 'done' } },
          processAndBroadcastEvent: stores.processAndBroadcastEvent,
          eventLedger: stores.eventLedger,
          agentResponseStore: stores.agentResponseStore as never,
          subagentOrchestrator: stores.subagentOrchestrator,
          stepCompletionFinalizer,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('subagent question-idle-tracking enrolment', () => {
    it('tracks a subagent question by subagentExecutionId, not by workflowRunId', async () => {
      const questionIdleTracker = {
        trackQuestionsPosed: vi.fn().mockResolvedValue(undefined),
      };
      const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);

      await handleUserQuestionsPosedGatewayCompat({
        client: {
          role: 'agent',
          workflowRunId: 'parent-run',
          isSubagent: true,
          subagentExecutionId: 'subagent-exec-1',
          containerId: 'subagent-container',
        } as never,
        payload: { questions: [{ text: 'What should I do next?' }] },
        processAndBroadcastEvent,
        questionIdleTracker,
      });

      expect(questionIdleTracker.trackQuestionsPosed).toHaveBeenCalledWith(
        'subagent-exec-1',
        'subagent-container',
      );
      expect(questionIdleTracker.trackQuestionsPosed).not.toHaveBeenCalledWith(
        'parent-run',
        expect.anything(),
      );
    });

    it('still tracks a non-subagent question by workflowRunId', async () => {
      const questionIdleTracker = {
        trackQuestionsPosed: vi.fn().mockResolvedValue(undefined),
      };
      const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);

      await handleUserQuestionsPosedGatewayCompat({
        client: {
          role: 'agent',
          workflowRunId: 'run-step',
          isSubagent: false,
          containerId: 'step-container',
        } as never,
        payload: { questions: [{ text: 'Confirm?' }] },
        processAndBroadcastEvent,
        questionIdleTracker,
      });

      expect(questionIdleTracker.trackQuestionsPosed).toHaveBeenCalledWith(
        'run-step',
        'step-container',
      );
    });

    it('clears subagent idle tracking when the subagent agent ends', async () => {
      const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
      const eventLedger = {
        emitBestEffort: vi.fn().mockResolvedValue(undefined),
      };
      const agentResponseStore = {
        store: vi.fn().mockResolvedValue(undefined),
        storeStepComplete: vi.fn().mockResolvedValue(undefined),
      };
      const subagentOrchestrator = {
        handleCompletion: vi.fn().mockResolvedValue(undefined),
      };
      const questionIdleTracker = {
        clearTracking: vi.fn(),
      };

      await handleAgentEndGatewayCompat({
        client: {
          role: 'agent',
          workflowRunId: 'run-parent',
          isSubagent: true,
          subagentExecutionId: 'subagent-exec-2',
        } as never,
        payload: { output: { ok: true, response: 'done' } },
        processAndBroadcastEvent,
        eventLedger,
        agentResponseStore: agentResponseStore as never,
        subagentOrchestrator,
        questionIdleTracker,
      });

      expect(questionIdleTracker.clearTracking).toHaveBeenCalledWith(
        'subagent-exec-2',
      );
    });

    it('does not clear idle tracking for non-subagent agents on agent_end', async () => {
      const processAndBroadcastEvent = vi.fn().mockResolvedValue(undefined);
      const eventLedger = {
        emitBestEffort: vi.fn().mockResolvedValue(undefined),
      };
      const agentResponseStore = {
        store: vi.fn().mockResolvedValue(undefined),
        storeStepComplete: vi.fn().mockResolvedValue(undefined),
      };
      const subagentOrchestrator = {
        handleCompletion: vi.fn().mockResolvedValue(undefined),
      };
      const questionIdleTracker = {
        clearTracking: vi.fn(),
      };

      await handleAgentEndGatewayCompat({
        client: {
          role: 'agent',
          workflowRunId: 'run-step',
          isSubagent: false,
        } as never,
        payload: { output: { ok: true, response: 'done' } },
        processAndBroadcastEvent,
        eventLedger,
        agentResponseStore: agentResponseStore as never,
        subagentOrchestrator,
        questionIdleTracker,
      });

      expect(questionIdleTracker.clearTracking).not.toHaveBeenCalled();
    });
  });
});
