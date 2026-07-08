import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { SubagentCoordinationService } from './subagent-coordination.service';
import type { SubagentExecutionView } from './subagent-execution-view.types';

const EXECUTION_MOCK: SubagentExecutionView = {
  id: 'exec-1',
  parent_container_id: 'parent-1',
  child_container_id: 'child-1',
  parent_session_tree_id: 'session-1',
  status: 'Completed',
  result: {},
  created_at: new Date(),
  completed_at: new Date(),
  assigned_files: [],
  depth: 1,
  subagent_chat_session_id: 'chat-1',
};

function buildCoordinationService(options: {
  provisioningSpawn: ReturnType<typeof vi.fn>;
  dispatchQueuedDelegations: ReturnType<typeof vi.fn>;
  runRepo?: {
    findById?: ReturnType<typeof vi.fn>;
    setStateVariableAtomic?: ReturnType<typeof vi.fn>;
  };
  executionRepo?: {
    findByContainerId?: ReturnType<typeof vi.fn>;
  };
}): SubagentCoordinationService {
  process.env.JWT_SECRET = 'test-jwt-secret';

  return new SubagentCoordinationService(
    { upsert: vi.fn().mockResolvedValue(undefined) } as never,
    {
      findById: vi.fn().mockResolvedValue(EXECUTION_MOCK),
      findByParentContainerId: vi.fn().mockResolvedValue([]),
    } as never,
    { killContainer: vi.fn(), removeContainer: vi.fn() } as never,
    { delete: vi.fn().mockResolvedValue(undefined) } as never,
    { cleanupSkillMount: vi.fn() } as never,
    {
      saveSessionForChat: vi.fn().mockResolvedValue(undefined),
      saveSessionForWorkflowChat: vi.fn().mockResolvedValue(undefined),
    } as never,
    { update: vi.fn().mockResolvedValue(undefined) } as never,
    {
      handleSubagentCompletion: vi.fn().mockResolvedValue({
        workflow_run_id: 'wf-1',
        parent_container_id: 'parent-1',
      }),
      dispatchQueuedDelegations: options.dispatchQueuedDelegations,
      handleSubagentCancellation: vi.fn(),
    } as never,
    {
      resumeParentAfterSubagent: vi.fn().mockResolvedValue(undefined),
    } as never,
    { emit: vi.fn().mockResolvedValue(undefined) } as never,
    {
      runExclusive: vi.fn(
        async <T>(_key: string, fn: () => Promise<T>): Promise<T> => fn(),
      ),
    } as never,
    { spawn: options.provisioningSpawn } as never,
    { findLatestTurnForStep: vi.fn() } as never,
    {
      completed: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(undefined),
      cancelled: vi.fn().mockResolvedValue(undefined),
      created: vi.fn().mockResolvedValue(undefined),
      provisioning: vi.fn().mockResolvedValue(undefined),
      provisioned: vi.fn().mockResolvedValue(undefined),
      running: vi.fn().mockResolvedValue(undefined),
    } as never,
    (options.runRepo ?? {
      findById: vi.fn().mockResolvedValue(null),
      setStateVariableAtomic: vi.fn().mockResolvedValue(undefined),
    }) as never,
    (options.executionRepo ?? {
      findByContainerId: vi.fn().mockResolvedValue(null),
    }) as never,
    { isContainerLost: vi.fn().mockResolvedValue(true) } as never,
  );
}

describe('SubagentCoordinationService', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret';
  });

  it('threads resumeSessionTreeId from delegation spawn request to provisioning.spawn', async () => {
    const provisioningSpawn = vi.fn().mockResolvedValue('exec-2');
    const dispatchQueuedDelegations = vi.fn(
      async (params: {
        spawnHandler: (req: Record<string, unknown>) => Promise<string>;
      }) => {
        await params.spawnHandler({
          parentContainerId: 'parent-1',
          agentProfile: 'agent-1',
          taskPrompt: 'Test task',
          tools: [],
          tier: 'light',
          workflowRunId: 'wf-1',
          lifecycleStage: null,
          assignedFiles: [],
          contractId: 'contract-1',
          traceId: 'trace-1',
          parentTraceId: null,
          resumeSessionTreeId: 'tree-1',
        });
      },
    );

    const service = buildCoordinationService({
      provisioningSpawn,
      dispatchQueuedDelegations,
    });

    await service.handleCompletion('exec-1', {}, 'wf-1');

    expect(provisioningSpawn).toHaveBeenCalledWith(
      'parent-1',
      expect.objectContaining({
        resumeSessionTreeId: 'tree-1',
      }),
    );
  });

  describe('resolveResumeSessionTreeId', () => {
    it('resolves sessionTreeId from state_variables and clears entry on parent respawn', async () => {
      const provisioningSpawn = vi.fn().mockResolvedValue('exec-2');
      const setStateVariableAtomic = vi.fn().mockResolvedValue(undefined);
      const findById = vi.fn().mockImplementation((id: string) => {
        if (id === 'wf-1') {
          return Promise.resolve({
            id: 'wf-1',
            state_variables: {
              _internal: {
                'job-1': {
                  cancelled_subagent_resumes: [
                    {
                      executionId: 'exec-cancelled-1',
                      sessionTreeId: 'tree-resume-1',
                      agentProfileName: 'agent-1',
                      contractId: 'contract-1',
                    },
                  ],
                },
              },
            },
          });
        }
        return Promise.resolve(null);
      });
      const executionFindByContainerId = vi.fn().mockResolvedValue({
        id: 'parent-exec-1',
        context_id: 'job-1',
        container_id: 'parent-1',
      });

      const dispatchQueuedDelegations = vi.fn(
        async (params: {
          spawnHandler: (req: Record<string, unknown>) => Promise<string>;
        }) => {
          await params.spawnHandler({
            parentContainerId: 'parent-1',
            agentProfile: 'agent-1',
            taskPrompt: 'Test task',
            tools: [],
            tier: 'light',
            workflowRunId: 'wf-1',
            lifecycleStage: null,
            assignedFiles: [],
            contractId: 'contract-1',
            traceId: 'trace-1',
            parentTraceId: null,
          });
        },
      );

      const service = buildCoordinationService({
        provisioningSpawn,
        dispatchQueuedDelegations,
        runRepo: { findById, setStateVariableAtomic },
        executionRepo: { findByContainerId: executionFindByContainerId },
      });

      await service.handleCompletion('exec-1', {}, 'wf-1');

      expect(executionFindByContainerId).toHaveBeenCalledWith('parent-1');
      expect(setStateVariableAtomic).toHaveBeenCalledWith(
        'wf-1',
        '_internal.job-1.cancelled_subagent_resumes',
        [],
      );
      expect(provisioningSpawn).toHaveBeenCalledWith(
        'parent-1',
        expect.objectContaining({
          resumeSessionTreeId: 'tree-resume-1',
        }),
      );
    });

    it('returns undefined when no matching agentProfileName in cancelled_subagent_resumes', async () => {
      const provisioningSpawn = vi.fn().mockResolvedValue('exec-2');
      const setStateVariableAtomic = vi.fn().mockResolvedValue(undefined);
      const findById = vi.fn().mockResolvedValue({
        id: 'wf-1',
        state_variables: {
          _internal: {
            'job-1': {
              cancelled_subagent_resumes: [
                {
                  executionId: 'exec-cancelled-1',
                  sessionTreeId: 'tree-resume-1',
                  agentProfileName: 'other-agent',
                  contractId: 'contract-1',
                },
              ],
            },
          },
        },
      });
      const executionFindByContainerId = vi.fn().mockResolvedValue({
        id: 'parent-exec-1',
        context_id: 'job-1',
        container_id: 'parent-1',
      });

      const dispatchQueuedDelegations = vi.fn(
        async (params: {
          spawnHandler: (req: Record<string, unknown>) => Promise<string>;
        }) => {
          await params.spawnHandler({
            parentContainerId: 'parent-1',
            agentProfile: 'agent-1',
            taskPrompt: 'Test',
            tools: [],
            tier: 'light',
            workflowRunId: 'wf-1',
            lifecycleStage: null,
            assignedFiles: [],
            contractId: 'contract-1',
            traceId: 'trace-1',
            parentTraceId: null,
          });
        },
      );

      const service = buildCoordinationService({
        provisioningSpawn,
        dispatchQueuedDelegations,
        runRepo: { findById, setStateVariableAtomic },
        executionRepo: { findByContainerId: executionFindByContainerId },
      });

      await service.handleCompletion('exec-1', {}, 'wf-1');

      expect(setStateVariableAtomic).not.toHaveBeenCalled();
      expect(provisioningSpawn).toHaveBeenCalledWith(
        'parent-1',
        expect.not.objectContaining({
          resumeSessionTreeId: expect.any(String),
        }),
      );
    });

    it('returns undefined when cancelled_subagent_resumes key is missing from state_variables', async () => {
      const provisioningSpawn = vi.fn().mockResolvedValue('exec-2');
      const setStateVariableAtomic = vi.fn();
      const findById = vi.fn().mockResolvedValue({
        id: 'wf-1',
        state_variables: {},
      });
      const executionFindByContainerId = vi.fn().mockResolvedValue({
        id: 'parent-exec-1',
        context_id: 'job-1',
        container_id: 'parent-1',
      });

      const dispatchQueuedDelegations = vi.fn(
        async (params: {
          spawnHandler: (req: Record<string, unknown>) => Promise<string>;
        }) => {
          await params.spawnHandler({
            parentContainerId: 'parent-1',
            agentProfile: 'agent-1',
            taskPrompt: 'Test',
            tools: [],
            tier: 'light',
            workflowRunId: 'wf-1',
            lifecycleStage: null,
            assignedFiles: [],
            contractId: 'contract-1',
            traceId: 'trace-1',
            parentTraceId: null,
          });
        },
      );

      const service = buildCoordinationService({
        provisioningSpawn,
        dispatchQueuedDelegations,
        runRepo: { findById, setStateVariableAtomic },
        executionRepo: { findByContainerId: executionFindByContainerId },
      });

      await service.handleCompletion('exec-1', {}, 'wf-1');

      expect(setStateVariableAtomic).not.toHaveBeenCalled();
      expect(provisioningSpawn).toHaveBeenCalledWith(
        'parent-1',
        expect.not.objectContaining({
          resumeSessionTreeId: expect.any(String),
        }),
      );
    });

    it('handles read error gracefully by logging warning and spawning without resumeSessionTreeId', async () => {
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const provisioningSpawn = vi.fn().mockResolvedValue('exec-2');
      const findById = vi.fn().mockRejectedValue(new Error('DB error'));
      const executionFindByContainerId = vi.fn().mockResolvedValue({
        id: 'parent-exec-1',
        context_id: 'job-1',
        container_id: 'parent-1',
      });

      const dispatchQueuedDelegations = vi.fn(
        async (params: {
          spawnHandler: (req: Record<string, unknown>) => Promise<string>;
        }) => {
          await params.spawnHandler({
            parentContainerId: 'parent-1',
            agentProfile: 'agent-1',
            taskPrompt: 'Test',
            tools: [],
            tier: 'light',
            workflowRunId: 'wf-1',
            lifecycleStage: null,
            assignedFiles: [],
            contractId: 'contract-1',
            traceId: 'trace-1',
            parentTraceId: null,
          });
        },
      );

      const service = buildCoordinationService({
        provisioningSpawn,
        dispatchQueuedDelegations,
        runRepo: { findById, setStateVariableAtomic: vi.fn() },
        executionRepo: { findByContainerId: executionFindByContainerId },
      });

      await service.handleCompletion('exec-1', {}, 'wf-1');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to read/clear cancelled subagent resume',
        ),
        expect.objectContaining({
          workflowRunId: 'wf-1',
          parentJobId: 'job-1',
          agentProfile: 'agent-1',
          delegationContractId: 'contract-1',
        }),
      );
      expect(provisioningSpawn).toHaveBeenCalledWith(
        'parent-1',
        expect.any(Object),
      );
      warnSpy.mockRestore();
    });
  });
});
