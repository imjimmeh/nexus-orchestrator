import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { HarnessProviderRegistryService } from '../../harness/harness-provider-registry.service';
import { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';
import {
  CHAT_SESSION_DOMAIN_PORT,
  CHAT_SESSION_REPOSITORY_PORT,
  type ChatSessionDomainPort,
  type IChatSessionRepositoryPort,
} from '../domain-ports';
import { InterruptionRecoveryService } from './interruption-recovery.service';
import { StepSessionCheckpointRepository } from '../workflow-session-checkpoint/step-session-checkpoint.repository.js';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { SubagentOrchestratorService } from '../workflow-subagents/subagent-orchestrator.service';
import type { PrepareRecoveryInput } from './interruption-recovery.types';

const mockReadFile = vi.hoisted(() =>
  vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory')),
);

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
}));

interface CheckpointRepoMock {
  recordCheckpoint: ReturnType<typeof vi.fn>;
}

describe('InterruptionRecoveryService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    mockReadFile.mockRejectedValue(
      new Error('ENOENT: no such file or directory'),
    );
  });

  const createService = async (
    options: {
      cancelActiveForParent?: ReturnType<typeof vi.fn>;
      chatSessionRepo?: Partial<IChatSessionRepositoryPort>;
      subagentDetailsRepo?: Partial<SubagentDetailsRepository>;
      sessionHydration?: Partial<ChatSessionDomainPort>;
      harnessRegistry?: Partial<HarnessProviderRegistryService>;
      checkpointRepo?: CheckpointRepoMock;
      runRepo?: Partial<IWorkflowRunRepository>;
    } = {},
  ): Promise<InterruptionRecoveryService> => {
    const cancelActiveForParent =
      options.cancelActiveForParent ??
      vi.fn().mockResolvedValue({ cancelled_execution_ids: [] });
    const chatSessionRepo: Partial<IChatSessionRepositoryPort> =
      options.chatSessionRepo ?? {
        findParentByWorkflowRunId: vi.fn().mockResolvedValue(null),
        findBySubagentExecutionId: vi.fn().mockResolvedValue(null),
      };
    const subagentDetailsRepo: Partial<SubagentDetailsRepository> =
      options.subagentDetailsRepo ?? {
        findByExecutionId: vi.fn().mockResolvedValue(null),
      };
    const sessionHydration: Partial<ChatSessionDomainPort> =
      options.sessionHydration ?? {
        appendSystemResultNode: vi.fn().mockResolvedValue('default-node-id'),
        saveSessionFromJsonl: vi.fn(),
      };
    const harnessRegistry: Partial<HarnessProviderRegistryService> =
      options.harnessRegistry ?? {
        resolve: vi.fn().mockReturnValue({
          capabilities: { resumeMechanism: 'file_injection' },
        }),
      };
    const checkpointRepo: CheckpointRepoMock = options.checkpointRepo ?? {
      recordCheckpoint: vi.fn().mockResolvedValue(undefined),
    };
    const runRepo: Partial<IWorkflowRunRepository> = options.runRepo ?? {
      setStateVariableAtomic: vi.fn().mockResolvedValue(undefined),
    };
    const subagentOrchestrator = { cancelActiveForParent };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        InterruptionRecoveryService,
        {
          provide: CHAT_SESSION_REPOSITORY_PORT,
          useValue: chatSessionRepo,
        },
        {
          provide: CHAT_SESSION_DOMAIN_PORT,
          useValue: sessionHydration,
        },
        { provide: SubagentDetailsRepository, useValue: subagentDetailsRepo },
        { provide: HarnessProviderRegistryService, useValue: harnessRegistry },
        {
          provide: StepSessionCheckpointRepository,
          useValue: checkpointRepo,
        },
        { provide: WORKFLOW_RUN_REPOSITORY_PORT, useValue: runRepo },
        {
          provide: SubagentOrchestratorService,
          useValue: subagentOrchestrator,
        },
      ],
    }).compile();
    return moduleRef.get(InterruptionRecoveryService);
  };

  const makeInput = (
    overrides: Partial<PrepareRecoveryInput> = {},
  ): PrepareRecoveryInput => ({
    workflowRunId: 'wf-run-1',
    jobId: 'job-1',
    parentContainerIds: new Set(['container-1']),
    source: 'stale-run-watchdog',
    sidecarSessionJsonl: null,
    containerTier: undefined,
    ...overrides,
  });

  describe('prepareRecovery', () => {
    it('cancels subagents per container id', async () => {
      const cancelActiveForParent = vi
        .fn()
        .mockResolvedValueOnce({ cancelled_execution_ids: ['exec-a'] })
        .mockResolvedValueOnce({ cancelled_execution_ids: ['exec-b'] });
      const service = await createService({ cancelActiveForParent });

      const result = await service.prepareRecovery(
        makeInput({
          parentContainerIds: new Set(['container-a', 'container-b']),
        }),
      );

      expect(cancelActiveForParent).toHaveBeenCalledTimes(2);
      expect(cancelActiveForParent).toHaveBeenCalledWith('container-a', {
        workflowRunId: 'wf-run-1',
        reason: expect.stringContaining('stale-run-watchdog'),
      });
      expect(cancelActiveForParent).toHaveBeenCalledWith('container-b', {
        workflowRunId: 'wf-run-1',
        reason: expect.stringContaining('stale-run-watchdog'),
      });
      expect(result.cancelledSubagentExecutions).toEqual([
        { executionId: 'exec-a' },
        { executionId: 'exec-b' },
      ]);
    });

    it('returns empty cancelledSubagentExecutions when no containers', async () => {
      const cancelActiveForParent = vi.fn();
      const service = await createService({ cancelActiveForParent });

      const result = await service.prepareRecovery(
        makeInput({ parentContainerIds: new Set() }),
      );

      expect(cancelActiveForParent).not.toHaveBeenCalled();
      expect(result.cancelledSubagentExecutions).toEqual([]);
    });

    it('catches cancellation errors and continues processing remaining containers', async () => {
      const cancelActiveForParent = vi.fn();
      cancelActiveForParent
        .mockRejectedValueOnce(new Error('container-1 exploded'))
        .mockResolvedValueOnce({ cancelled_execution_ids: ['exec-2'] });
      const service = await createService({ cancelActiveForParent });

      const result = await service.prepareRecovery(
        makeInput({
          parentContainerIds: new Set(['container-1', 'container-2']),
        }),
      );

      expect(cancelActiveForParent).toHaveBeenCalledTimes(2);
      expect(result.cancelledSubagentExecutions).toEqual([
        { executionId: 'exec-2' },
      ]);
    });

    it('collects cancelled execution ids from all containers', async () => {
      const cancelActiveForParent = vi.fn();
      cancelActiveForParent
        .mockResolvedValueOnce({
          cancelled_execution_ids: ['exec-a', 'exec-b'],
        })
        .mockResolvedValueOnce({ cancelled_execution_ids: ['exec-c'] });
      const service = await createService({ cancelActiveForParent });

      const result = await service.prepareRecovery(
        makeInput({
          parentContainerIds: new Set(['container-1', 'container-2']),
        }),
      );

      expect(result.cancelledSubagentExecutions).toEqual([
        { executionId: 'exec-a' },
        { executionId: 'exec-b' },
        { executionId: 'exec-c' },
      ]);
    });

    it('does not crash when subagentOrchestrator returns no cancelled ids', async () => {
      const cancelActiveForParent = vi
        .fn()
        .mockResolvedValue({ cancelled_execution_ids: [] });
      const service = await createService({ cancelActiveForParent });

      const result = await service.prepareRecovery(
        makeInput({
          parentContainerIds: new Set(['container-1', 'container-2']),
        }),
      );

      expect(cancelActiveForParent).toHaveBeenCalledTimes(2);
      expect(result.cancelledSubagentExecutions).toEqual([]);
    });

    it('enriches cancelled subagent executions with session info from chat_sessions and contract id from subagent_details', async () => {
      const cancelActiveForParent = vi.fn().mockResolvedValue({
        cancelled_execution_ids: ['exec-sub-1', 'exec-sub-2'],
      });
      const chatSessionRepo = {
        findParentByWorkflowRunId: vi.fn().mockResolvedValue(null),
        findByWorkflowRunIdAndSource: vi.fn().mockResolvedValue(null),
        findBySubagentExecutionId: vi
          .fn()
          .mockImplementation((executionId: string) => {
            if (executionId === 'exec-sub-1') {
              return Promise.resolve({
                id: 'session-1',
                session_tree_id: 'tree-sub-1',
                agent_profile_name: 'senior_dev',
              });
            }
            return Promise.resolve(null);
          }),
      };
      const subagentDetailsRepo = {
        findByExecutionId: vi.fn().mockImplementation((executionId: string) => {
          if (executionId === 'exec-sub-1') {
            return Promise.resolve({
              execution_id: executionId,
              delegation_contract_id: 'contract-uuid-1',
            });
          }
          return Promise.resolve(null);
        }),
      };
      const service = await createService({
        cancelActiveForParent,
        chatSessionRepo,
        subagentDetailsRepo,
      });

      const result = await service.prepareRecovery(
        makeInput({
          parentContainerIds: new Set(['container-1']),
        }),
      );

      expect(result.cancelledSubagentExecutions).toHaveLength(2);
      expect(result.cancelledSubagentExecutions[0]).toEqual({
        executionId: 'exec-sub-1',
        sessionTreeId: 'tree-sub-1',
        agentProfileName: 'senior_dev',
        contractId: 'contract-uuid-1',
      });
      expect(result.cancelledSubagentExecutions[1]).toEqual({
        executionId: 'exec-sub-2',
      });
      expect(subagentDetailsRepo.findByExecutionId).toHaveBeenCalledWith(
        'exec-sub-1',
      );
      expect(subagentDetailsRepo.findByExecutionId).toHaveBeenCalledWith(
        'exec-sub-2',
      );
    });

    it('wraps each subagent session lookup in try/catch', async () => {
      const cancelActiveForParent = vi.fn().mockResolvedValue({
        cancelled_execution_ids: ['exec-bad'],
      });
      const chatSessionRepo = {
        findParentByWorkflowRunId: vi.fn().mockResolvedValue(null),
        findByWorkflowRunIdAndSource: vi.fn().mockResolvedValue(null),
        findBySubagentExecutionId: vi
          .fn()
          .mockRejectedValue(new Error('DB timeout')),
      };
      const service = await createService({
        cancelActiveForParent,
        chatSessionRepo,
      });

      const result = await service.prepareRecovery(
        makeInput({ parentContainerIds: new Set(['container-1']) }),
      );

      expect(result.cancelledSubagentExecutions).toEqual([
        { executionId: 'exec-bad' },
      ]);
    });

    it('wraps each subagent details lookup in try/catch', async () => {
      const cancelActiveForParent = vi.fn().mockResolvedValue({
        cancelled_execution_ids: ['exec-bad'],
      });
      const chatSessionRepo = {
        findParentByWorkflowRunId: vi.fn().mockResolvedValue(null),
        findByWorkflowRunIdAndSource: vi.fn().mockResolvedValue(null),
        findBySubagentExecutionId: vi.fn().mockResolvedValue(null),
      };
      const subagentDetailsRepo = {
        findByExecutionId: vi.fn().mockRejectedValue(new Error('DB timeout')),
      };
      const service = await createService({
        cancelActiveForParent,
        chatSessionRepo,
        subagentDetailsRepo,
      });

      const result = await service.prepareRecovery(
        makeInput({ parentContainerIds: new Set(['container-1']) }),
      );

      expect(result.cancelledSubagentExecutions).toEqual([
        { executionId: 'exec-bad' },
      ]);
    });

    describe('parent session tree resolution', () => {
      describe('source: stale-run-watchdog', () => {
        it('resolves parentTreeId from chat_session when session has session_tree_id', async () => {
          const sessionTreeId = 'tree-uuid-123';
          const chatSessionRepo = {
            findParentByWorkflowRunId: vi
              .fn()
              .mockResolvedValue({ session_tree_id: sessionTreeId }),
          };
          const service = await createService({ chatSessionRepo });

          const result = await service.prepareRecovery(
            makeInput({
              source: 'stale-run-watchdog',
              workflowRunId: 'wf-run-1',
            }),
          );

          expect(
            chatSessionRepo.findParentByWorkflowRunId,
          ).toHaveBeenCalledWith('wf-run-1');
          expect(result.parentResume).toBeDefined();
          expect(result.parentResume!.resumeSessionTreeId).toBe(sessionTreeId);
          expect(result.parentResume!.resumeSessionRef).toEqual({
            kind: 'pi',
            treeId: sessionTreeId,
            resumeNodeId: 'default-node-id',
          });
        });

        it('leaves parentResume undefined when no chat session found', async () => {
          const chatSessionRepo = {
            findParentByWorkflowRunId: vi.fn().mockResolvedValue(null),
          };
          const service = await createService({ chatSessionRepo });

          const result = await service.prepareRecovery(
            makeInput({
              source: 'stale-run-watchdog',
              workflowRunId: 'wf-run-1',
            }),
          );

          expect(result.parentResume).toBeUndefined();
        });

        it('leaves parentResume undefined when session has no session_tree_id', async () => {
          const chatSessionRepo = {
            findParentByWorkflowRunId: vi
              .fn()
              .mockResolvedValue({ session_tree_id: null }),
          };
          const service = await createService({ chatSessionRepo });

          const result = await service.prepareRecovery(
            makeInput({
              source: 'stale-run-watchdog',
              workflowRunId: 'wf-run-1',
            }),
          );

          expect(result.parentResume).toBeUndefined();
        });

        it('returns graceful empty result when findParentByWorkflowRunId throws (defensive)', async () => {
          const chatSessionRepo = {
            findParentByWorkflowRunId: vi
              .fn()
              .mockRejectedValue(new Error('connection lost')),
          };
          const service = await createService({ chatSessionRepo });

          const result = await service.prepareRecovery(
            makeInput({
              source: 'stale-run-watchdog',
              workflowRunId: 'wf-run-1',
            }),
          );

          expect(result.parentResume).toBeUndefined();
          expect(result.cancelledSubagentExecutions).toEqual([]);
        });
      });

      describe('source: supervisor-reap', () => {
        it('persists sidecar session and returns tree id', async () => {
          const treeId = 'sidecar-tree-456';
          const appendSystemResultNode = vi
            .fn()
            .mockResolvedValue('sidecar-node');
          const sessionHydration = {
            saveSessionFromJsonl: vi.fn().mockResolvedValue(treeId),
            appendSystemResultNode,
          };
          const service = await createService({ sessionHydration });

          const result = await service.prepareRecovery(
            makeInput({
              source: 'supervisor-reap',
              workflowRunId: 'wf-run-1',
              sidecarSessionJsonl: '{"id":"node-1"}\n{"id":"node-2"}',
              containerTier: 2,
            }),
          );

          expect(sessionHydration.saveSessionFromJsonl).toHaveBeenCalledWith(
            '{"id":"node-1"}\n{"id":"node-2"}',
            { workflow_run_id: 'wf-run-1' },
            { containerTier: 2 },
          );
          expect(result.parentResume).toBeDefined();
          expect(result.parentResume!.resumeSessionTreeId).toBe(treeId);
          expect(result.parentResume!.resumeSessionRef).toEqual({
            kind: 'pi',
            treeId,
            resumeNodeId: 'sidecar-node',
          });
        });

        it('leaves parentResume undefined when sidecarSessionJsonl is null', async () => {
          const sessionHydration = {
            saveSessionFromJsonl: vi.fn(),
          };
          const service = await createService({ sessionHydration });

          const result = await service.prepareRecovery(
            makeInput({
              source: 'supervisor-reap',
              sidecarSessionJsonl: null,
            }),
          );

          expect(sessionHydration.saveSessionFromJsonl).not.toHaveBeenCalled();
          expect(result.parentResume).toBeUndefined();
        });

        it('leaves parentResume undefined when sidecarSessionJsonl is empty', async () => {
          const sessionHydration = {
            saveSessionFromJsonl: vi.fn(),
          };
          const service = await createService({ sessionHydration });

          const result = await service.prepareRecovery(
            makeInput({
              source: 'supervisor-reap',
              sidecarSessionJsonl: '',
            }),
          );

          expect(sessionHydration.saveSessionFromJsonl).not.toHaveBeenCalled();
          expect(result.parentResume).toBeUndefined();
        });

        it('leaves parentResume undefined when saveSessionFromJsonl throws (best-effort)', async () => {
          const sessionHydration = {
            saveSessionFromJsonl: vi
              .fn()
              .mockRejectedValue(new Error('invalid JSONL')),
          };
          const service = await createService({ sessionHydration });

          const result = await service.prepareRecovery(
            makeInput({
              source: 'supervisor-reap',
              sidecarSessionJsonl: 'bad-json',
              containerTier: 1,
            }),
          );

          expect(sessionHydration.saveSessionFromJsonl).toHaveBeenCalled();
          expect(result.parentResume).toBeUndefined();
        });

        it('reads sidecar session.jsonl from checkpoint path when sidecarSessionJsonl not provided', async () => {
          const treeId = 'sidecar-tree-file';
          const appendSystemResultNode = vi
            .fn()
            .mockResolvedValue('sidecar-node-file');
          const sessionHydration = {
            saveSessionFromJsonl: vi.fn().mockResolvedValue(treeId),
            appendSystemResultNode,
          };
          const service = await createService({ sessionHydration });
          mockReadFile.mockResolvedValue('{"id":"node-a"}\n{"id":"node-b"}');

          const result = await service.prepareRecovery(
            makeInput({
              source: 'supervisor-reap',
              workflowRunId: 'wf-run-1',
              jobId: 'job-1',
              sidecarSessionJsonl: null,
              containerTier: 2,
            }),
          );

          expect(mockReadFile).toHaveBeenCalledWith(
            expect.stringContaining('session.jsonl'),
            'utf8',
          );
          expect(sessionHydration.saveSessionFromJsonl).toHaveBeenCalledWith(
            '{"id":"node-a"}\n{"id":"node-b"}',
            { workflow_run_id: 'wf-run-1' },
            { containerTier: 2 },
          );
          expect(result.parentResume).toBeDefined();
          expect(result.parentResume!.resumeSessionTreeId).toBe(treeId);
        });

        it('gracefully returns empty when sidecar file read fails (ENOENT)', async () => {
          const sessionHydration = {
            saveSessionFromJsonl: vi.fn(),
          };
          const service = await createService({ sessionHydration });

          const result = await service.prepareRecovery(
            makeInput({
              source: 'supervisor-reap',
              workflowRunId: 'wf-run-1',
              jobId: 'job-1',
              sidecarSessionJsonl: null,
            }),
          );

          expect(mockReadFile).toHaveBeenCalled();
          expect(sessionHydration.saveSessionFromJsonl).not.toHaveBeenCalled();
          expect(result.parentResume).toBeUndefined();
        });

        it('uses claude-code harness from parent chat session when recovering from supervisor-reap', async () => {
          const treeId = 'sidecar-tree-cc';
          const sessionHydration = {
            saveSessionFromJsonl: vi.fn().mockResolvedValue(treeId),
            appendSystemResultNode: vi.fn(),
          };
          const harnessRegistry = {
            resolve: vi.fn().mockReturnValue({
              capabilities: { resumeMechanism: 'config_ref' },
            }),
          };
          const chatSessionRepo = {
            findParentByWorkflowRunId: vi.fn().mockResolvedValue({
              id: 'parent-session-cc',
              session_tree_id: 'parent-tree-cc',
              harness_id: 'claude-code',
            }),
            findByWorkflowRunIdAndSource: vi.fn().mockResolvedValue(null),
            findBySubagentExecutionId: vi.fn().mockResolvedValue(null),
          };
          const service = await createService({
            sessionHydration,
            harnessRegistry,
            chatSessionRepo,
          });

          const result = await service.prepareRecovery(
            makeInput({
              source: 'supervisor-reap',
              workflowRunId: 'wf-run-cc',
              sidecarSessionJsonl: '{"id":"n1"}\n{"id":"n2"}',
              containerTier: 2,
            }),
          );

          expect(
            chatSessionRepo.findParentByWorkflowRunId,
          ).toHaveBeenCalledWith('wf-run-cc');
          expect(result.parentResume).toBeDefined();
          expect(result.parentResume!.resumeSessionTreeId).toBe(treeId);
          expect(result.parentResume!.resumeSessionRef).toEqual({
            kind: 'claude_code',
            sessionId: 'parent-session-cc',
          });
        });

        it('uses pi harness from parent chat session when recovering from supervisor-reap', async () => {
          const treeId = 'sidecar-tree-pi';
          const appendSystemResultNode = vi
            .fn()
            .mockResolvedValue('result-node-pi');
          const sessionHydration = {
            saveSessionFromJsonl: vi.fn().mockResolvedValue(treeId),
            appendSystemResultNode,
          };
          const harnessRegistry = {
            resolve: vi.fn().mockReturnValue({
              capabilities: { resumeMechanism: 'file_injection' },
            }),
          };
          const chatSessionRepo = {
            findParentByWorkflowRunId: vi.fn().mockResolvedValue({
              id: 'parent-session-pi',
              session_tree_id: 'parent-tree-pi',
              harness_id: 'pi',
            }),
            findByWorkflowRunIdAndSource: vi.fn().mockResolvedValue(null),
            findBySubagentExecutionId: vi.fn().mockResolvedValue(null),
          };
          const service = await createService({
            sessionHydration,
            harnessRegistry,
            chatSessionRepo,
          });

          const result = await service.prepareRecovery(
            makeInput({
              source: 'supervisor-reap',
              workflowRunId: 'wf-run-pi',
              sidecarSessionJsonl: '{"id":"n1"}',
              containerTier: 1,
            }),
          );

          expect(
            chatSessionRepo.findParentByWorkflowRunId,
          ).toHaveBeenCalledWith('wf-run-pi');
          expect(result.parentResume).toBeDefined();
          expect(result.parentResume!.resumeSessionTreeId).toBe(treeId);
          expect(result.parentResume!.resumeSessionRef).toEqual({
            kind: 'pi',
            treeId,
            resumeNodeId: 'result-node-pi',
          });
        });

        it('defaults to pi harness when no parent chat session found for supervisor-reap', async () => {
          const treeId = 'sidecar-tree-no-session';
          const appendSystemResultNode = vi
            .fn()
            .mockResolvedValue('node-no-session');
          const sessionHydration = {
            saveSessionFromJsonl: vi.fn().mockResolvedValue(treeId),
            appendSystemResultNode,
          };
          const chatSessionRepo = {
            findParentByWorkflowRunId: vi.fn().mockResolvedValue(null),
            findByWorkflowRunIdAndSource: vi.fn().mockResolvedValue(null),
            findBySubagentExecutionId: vi.fn().mockResolvedValue(null),
          };
          const service = await createService({
            sessionHydration,
            chatSessionRepo,
          });

          const result = await service.prepareRecovery(
            makeInput({
              source: 'supervisor-reap',
              workflowRunId: 'wf-run-no-session',
              sidecarSessionJsonl: '{"id":"n1"}',
              containerTier: 1,
            }),
          );

          expect(
            chatSessionRepo.findParentByWorkflowRunId,
          ).toHaveBeenCalledWith('wf-run-no-session');
          expect(result.parentResume).toBeDefined();
          expect(result.parentResume!.resumeSessionTreeId).toBe(treeId);
          expect(result.parentResume!.resumeSessionRef).toEqual({
            kind: 'pi',
            treeId,
            resumeNodeId: 'node-no-session',
          });
        });
      });
    });

    it('writes a step_session_checkpoint row pointing to the resolved tree', async () => {
      const recordCheckpoint = vi.fn().mockResolvedValue(undefined);
      const service = await createService({
        chatSessionRepo: {
          findParentByWorkflowRunId: vi.fn().mockResolvedValue({
            session_tree_id: 'tree-1',
            harness_id: 'pi',
            source: 'AD_HOC',
          }),
        },
        sessionHydration: {
          appendSystemResultNode: vi.fn().mockResolvedValue('node-1'),
          saveSessionFromJsonl: vi.fn(),
        },
        harnessRegistry: {
          resolve: vi.fn().mockReturnValue({
            capabilities: { resumeMechanism: 'file_injection' },
          }),
        },
        checkpointRepo: { recordCheckpoint },
      });

      await service.prepareRecovery({
        workflowRunId: 'run-1',
        jobId: 'implement_and_commit',
        parentContainerIds: new Set(),
        source: 'stale-run-watchdog',
        parentExecutionId: 'exec-parent-1',
      });

      expect(recordCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          run_id: 'run-1',
          job_id: 'implement_and_commit',
          execution_id: 'exec-parent-1',
          session_tree_id: 'tree-1',
          session_ref: { kind: 'pi', treeId: 'tree-1', resumeNodeId: 'node-1' },
          engine: 'pi',
          phase: 'result',
        }),
      );
    });

    describe('result node injection based on harness resumeMechanism', () => {
      it('appends nexus_system result node for file_injection harness (PI)', async () => {
        const appendSystemResultNode = vi
          .fn()
          .mockResolvedValue('result-node-1');
        const sessionHydration = {
          appendSystemResultNode,
          saveSessionFromJsonl: vi.fn(),
        };
        const harnessRegistry = {
          resolve: vi.fn().mockReturnValue({
            capabilities: { resumeMechanism: 'file_injection' },
          }),
        };
        const chatSessionRepo = {
          findParentByWorkflowRunId: vi.fn().mockResolvedValue({
            session_tree_id: 'parent-tree-1',
            harness_id: 'pi',
          }),
        };
        const service = await createService({
          chatSessionRepo,
          sessionHydration,
          harnessRegistry,
        });

        const result = await service.prepareRecovery({
          workflowRunId: 'run-1',
          jobId: 'j1',
          parentContainerIds: new Set(),
          source: 'stale-run-watchdog',
        });
        expect(appendSystemResultNode).toHaveBeenCalledWith(
          'parent-tree-1',
          expect.stringContaining('wait_for_subagents interrupted'),
        );
        expect(result.parentResume?.resumeSessionRef).toEqual({
          kind: 'pi',
          treeId: 'parent-tree-1',
          resumeNodeId: 'result-node-1',
        });
      });

      it('does not append result node for config_ref harness (Claude Code)', async () => {
        const appendSystemResultNode = vi.fn();
        const sessionHydration = {
          appendSystemResultNode,
          saveSessionFromJsonl: vi.fn(),
        };
        const harnessRegistry = {
          resolve: vi.fn().mockReturnValue({
            capabilities: { resumeMechanism: 'config_ref' },
          }),
        };
        const chatSessionRepo = {
          findParentByWorkflowRunId: vi.fn().mockResolvedValue({
            session_tree_id: 'cc-tree-1',
            harness_id: 'claude-code',
          }),
        };
        const service = await createService({
          chatSessionRepo,
          sessionHydration,
          harnessRegistry,
        });

        const result = await service.prepareRecovery({
          workflowRunId: 'run-1',
          jobId: 'j1',
          parentContainerIds: new Set(),
          source: 'stale-run-watchdog',
        });
        expect(appendSystemResultNode).not.toHaveBeenCalled();
        expect(result.parentResume?.resumeSessionRef).toEqual({
          kind: 'claude_code',
          sessionId: 'cc-tree-1',
        });
      });

      it('returns pi resume ref for any file_injection harness (custom harness maps to pi semantics)', async () => {
        const appendSystemResultNode = vi.fn().mockResolvedValue('node-custom');
        const sessionHydration = {
          appendSystemResultNode,
          saveSessionFromJsonl: vi.fn(),
        };
        const harnessRegistry = {
          resolve: vi.fn().mockReturnValue({
            capabilities: { resumeMechanism: 'file_injection' },
          }),
        };
        const chatSessionRepo = {
          findParentByWorkflowRunId: vi.fn().mockResolvedValue({
            session_tree_id: 'tree-custom',
            harness_id: 'custom:my-harness',
          }),
        };
        const service = await createService({
          chatSessionRepo,
          sessionHydration,
          harnessRegistry,
        });

        const result = await service.prepareRecovery({
          workflowRunId: 'run-1',
          jobId: 'j1',
          parentContainerIds: new Set(),
          source: 'stale-run-watchdog',
        });
        expect(result.parentResume?.resumeSessionRef).toEqual({
          kind: 'pi',
          treeId: 'tree-custom',
          resumeNodeId: 'node-custom',
        });
      });
    });

    it('logs warning when recordCheckpoint fails and returns gracefully', async () => {
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const recordCheckpoint = vi
        .fn()
        .mockRejectedValue(new Error('DB timeout'));
      const service = await createService({
        chatSessionRepo: {
          findParentByWorkflowRunId: vi.fn().mockResolvedValue({
            session_tree_id: 'tree-1',
            harness_id: 'pi',
          }),
        },
        sessionHydration: {
          appendSystemResultNode: vi.fn().mockResolvedValue('node-1'),
          saveSessionFromJsonl: vi.fn(),
        },
        checkpointRepo: { recordCheckpoint },
      });

      const result = await service.prepareRecovery(
        makeInput({ source: 'stale-run-watchdog' }),
      );

      expect(recordCheckpoint).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to record checkpoint'),
      );
      expect(result.parentResume).toBeDefined();
      warnSpy.mockRestore();
    });

    it('handles harnessRegistry.resolve throwing and returns graceful with undefined parentResume', async () => {
      const harnessRegistry = {
        resolve: vi.fn().mockImplementation(() => {
          throw new Error('Unknown harness');
        }),
      };
      const service = await createService({
        chatSessionRepo: {
          findParentByWorkflowRunId: vi.fn().mockResolvedValue({
            session_tree_id: 'tree-1',
            harness_id: 'custom:my-harness',
          }),
        },
        sessionHydration: {
          appendSystemResultNode: vi.fn(),
          saveSessionFromJsonl: vi.fn(),
        },
        harnessRegistry,
      });

      const result = await service.prepareRecovery(
        makeInput({ source: 'stale-run-watchdog' }),
      );

      expect(harnessRegistry.resolve).toHaveBeenCalledWith('custom:my-harness');
      expect(result.parentResume).toBeUndefined();
    });
  });

  describe('persistCancelledSubagentResumes', () => {
    it('persists cancelled subagent resumes to state_variables when subagents were cancelled', async () => {
      const setStateVariableAtomic = vi.fn().mockResolvedValue(undefined);
      const cancelActiveForParent = vi.fn().mockResolvedValue({
        cancelled_execution_ids: ['exec-1', 'exec-2'],
      });
      const chatSessionRepo = {
        findParentByWorkflowRunId: vi.fn().mockResolvedValue(null),
        findByWorkflowRunIdAndSource: vi.fn().mockResolvedValue(null),
        findBySubagentExecutionId: vi.fn().mockResolvedValue(null),
      };
      const service = await createService({
        cancelActiveForParent,
        chatSessionRepo,
        runRepo: { setStateVariableAtomic },
      });

      const result = await service.prepareRecovery(
        makeInput({
          jobId: 'implement_and_commit',
          parentContainerIds: new Set(['container-1']),
        }),
      );

      expect(setStateVariableAtomic).toHaveBeenCalledWith(
        'wf-run-1',
        '_internal.implement_and_commit.cancelled_subagent_resumes',
        result.cancelledSubagentExecutions,
      );
    });

    it('persists enriched CancelledSubagentExecution objects with all fields via setStateVariableAtomic', async () => {
      const setStateVariableAtomic = vi.fn().mockResolvedValue(undefined);
      const cancelActiveForParent = vi.fn().mockResolvedValue({
        cancelled_execution_ids: ['exec-full-1', 'exec-full-2'],
      });
      const chatSessionRepo = {
        findParentByWorkflowRunId: vi.fn().mockResolvedValue(null),
        findByWorkflowRunIdAndSource: vi.fn().mockResolvedValue(null),
        findBySubagentExecutionId: vi
          .fn()
          .mockImplementation((executionId: string) => {
            if (executionId === 'exec-full-1') {
              return Promise.resolve({
                id: 'session-full-1',
                session_tree_id: 'tree-full-1',
                agent_profile_name: 'senior_dev',
              });
            }
            if (executionId === 'exec-full-2') {
              return Promise.resolve({
                id: 'session-full-2',
                session_tree_id: 'tree-full-2',
                agent_profile_name: 'junior_dev',
              });
            }
            return Promise.resolve(null);
          }),
      };
      const subagentDetailsRepo = {
        findByExecutionId: vi.fn().mockImplementation((executionId: string) => {
          if (executionId === 'exec-full-1') {
            return Promise.resolve({
              execution_id: executionId,
              delegation_contract_id: 'contract-full-1',
            });
          }
          if (executionId === 'exec-full-2') {
            return Promise.resolve({
              execution_id: executionId,
              delegation_contract_id: 'contract-full-2',
            });
          }
          return Promise.resolve(null);
        }),
      };
      const service = await createService({
        cancelActiveForParent,
        chatSessionRepo,
        subagentDetailsRepo,
        runRepo: { setStateVariableAtomic },
      });

      const result = await service.prepareRecovery(
        makeInput({
          jobId: 'code_review',
          parentContainerIds: new Set(['container-1']),
        }),
      );

      expect(setStateVariableAtomic).toHaveBeenCalledWith(
        'wf-run-1',
        '_internal.code_review.cancelled_subagent_resumes',
        [
          {
            executionId: 'exec-full-1',
            sessionTreeId: 'tree-full-1',
            agentProfileName: 'senior_dev',
            contractId: 'contract-full-1',
          },
          {
            executionId: 'exec-full-2',
            sessionTreeId: 'tree-full-2',
            agentProfileName: 'junior_dev',
            contractId: 'contract-full-2',
          },
        ],
      );
    });

    it('logs warning and continues when setStateVariableAtomic fails', async () => {
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const setStateVariableAtomic = vi
        .fn()
        .mockRejectedValue(new Error('DB timeout'));
      const cancelActiveForParent = vi.fn().mockResolvedValue({
        cancelled_execution_ids: ['exec-1'],
      });
      const service = await createService({
        cancelActiveForParent,
        runRepo: { setStateVariableAtomic },
      });

      const result = await service.prepareRecovery(
        makeInput({ parentContainerIds: new Set(['container-1']) }),
      );

      expect(setStateVariableAtomic).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to persist cancelled subagent resumes'),
        expect.any(Error),
      );
      expect(result.cancelledSubagentExecutions).toEqual([
        { executionId: 'exec-1' },
      ]);
      expect(result.parentResume).toBeUndefined();
      warnSpy.mockRestore();
    });

    it('does not persist when cancelledSubagentExecutions is empty', async () => {
      const setStateVariableAtomic = vi.fn();
      const cancelActiveForParent = vi.fn().mockResolvedValue({
        cancelled_execution_ids: [],
      });
      const service = await createService({
        cancelActiveForParent,
        runRepo: { setStateVariableAtomic },
      });

      await service.prepareRecovery(
        makeInput({ parentContainerIds: new Set(['container-1']) }),
      );

      expect(setStateVariableAtomic).not.toHaveBeenCalled();
    });
  });
});
