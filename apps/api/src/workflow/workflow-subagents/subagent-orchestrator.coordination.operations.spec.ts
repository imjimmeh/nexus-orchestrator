import { ChatSessionStatus } from '@nexus/core';
import { describe, expect, it, vi } from 'vitest';
import type { SubagentExecutionView } from './subagent-execution-view.types';
import { cancelSubagentExecutionOperation } from './subagent-orchestrator.coordination.operations';
import type { SubagentCoordinationOperationsContext } from './subagent-orchestrator.operations.types';
import type { SubagentContainerLivenessProbe } from '../../execution-lifecycle/subagent-container-liveness.probe';

function buildExecution(
  overrides: Partial<SubagentExecutionView> = {},
): SubagentExecutionView {
  return {
    id: 'subagent-exec-1',
    parent_container_id: 'parent-container-1',
    child_container_id: 'child-container-1',
    subagent_chat_session_id: 'chat-session-1',
    status: 'Running',
    result: undefined,
    created_at: new Date('2026-04-30T00:00:00.000Z'),
    completed_at: undefined,
    ...overrides,
  } as SubagentExecutionView;
}

function buildLiveness(
  overrides: Partial<
    Record<keyof SubagentContainerLivenessProbe, unknown>
  > = {},
): Pick<SubagentContainerLivenessProbe, 'isContainerLost'> {
  return {
    isContainerLost: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as Pick<SubagentContainerLivenessProbe, 'isContainerLost'>;
}

function buildContext(
  overrides: Record<string, unknown> = {},
): SubagentCoordinationOperationsContext {
  return {
    subagentDetailsRepo: { upsert: vi.fn().mockResolvedValue(undefined) },
    chatSessionRepo: { update: vi.fn().mockResolvedValue(undefined) },
    containerOrchestrator: {
      killContainer: vi.fn().mockResolvedValue(undefined),
      removeContainer: vi.fn().mockResolvedValue(undefined),
    },
    skillMounting: { cleanupSkillMount: vi.fn() },
    emitSubagentLifecycleEvent: vi.fn().mockResolvedValue(undefined),
    executionEvents: { cancelled: vi.fn().mockResolvedValue(undefined) },
    liveness: buildLiveness(),
    logger: { warn: vi.fn() },
    ...overrides,
  } as unknown as SubagentCoordinationOperationsContext;
}

describe('cancelSubagentExecutionOperation', () => {
  it('marks linked subagent chat sessions cancelled when execution is cancelled', async () => {
    const cancelledAt = new Date('2026-04-30T00:02:00.000Z');
    const chatSessionUpdate = vi.fn().mockResolvedValue(undefined);
    const detailsUpsert = vi.fn().mockResolvedValue(undefined);
    const context = buildContext({
      subagentDetailsRepo: { upsert: detailsUpsert },
      chatSessionRepo: { update: chatSessionUpdate },
    });

    await cancelSubagentExecutionOperation(context, {
      parentContainerId: 'parent-container-1',
      workflowRunId: 'workflow-run-1',
      execution: buildExecution(),
      reason: 'parent_abort',
      cancelledAt,
    });

    expect(chatSessionUpdate).toHaveBeenCalledWith(
      'chat-session-1',
      expect.objectContaining({
        status: ChatSessionStatus.CANCELLED,
        execution_state: 'cancelled',
        completed_at: cancelledAt,
      }),
    );
    expect(detailsUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        execution_id: 'subagent-exec-1',
        result: expect.objectContaining({
          status: 'Failed',
          failure_reason: 'parent_abort',
        }),
      }),
    );
  });

  it('emits the execution cancelled lifecycle event with parent_terminated reason', async () => {
    const cancelledAt = new Date('2026-04-30T00:02:00.000Z');
    const cancelled = vi.fn().mockResolvedValue(undefined);
    const context = buildContext({
      executionEvents: { cancelled },
    });

    await cancelSubagentExecutionOperation(context, {
      parentContainerId: 'parent-container-1',
      workflowRunId: 'workflow-run-1',
      execution: buildExecution(),
      reason: 'parent_abort',
      cancelledAt,
    });

    expect(cancelled).toHaveBeenCalledWith(
      'subagent-exec-1',
      expect.objectContaining({ failure_reason: 'parent_terminated' }),
    );
  });

  it('re-issues removeContainer when the child container is still alive after the first removal', async () => {
    const removeContainer = vi.fn().mockResolvedValue(undefined);
    const liveness = buildLiveness({
      isContainerLost: vi
        .fn()
        .mockResolvedValueOnce(false) // still alive after first removal
        .mockResolvedValueOnce(true), // gone after second removal
    });
    const context = buildContext({
      containerOrchestrator: {
        killContainer: vi.fn().mockResolvedValue(undefined),
        removeContainer,
      },
      liveness,
    });

    await cancelSubagentExecutionOperation(context, {
      parentContainerId: 'parent-container-1',
      workflowRunId: 'workflow-run-1',
      execution: buildExecution({ child_container_id: 'cc1' }),
      reason: 'parent_abort',
      cancelledAt: new Date('2026-04-30T00:02:00.000Z'),
    });

    expect(removeContainer).toHaveBeenCalledTimes(2);
  });
});
