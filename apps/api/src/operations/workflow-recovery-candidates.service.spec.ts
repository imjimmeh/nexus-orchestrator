import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowStatus } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionRepository } from '../execution-lifecycle/database/repositories/execution.repository';
import type { ExecutionEntity } from '../execution-lifecycle/database/entities/execution.entity';
import type { WorkflowRun } from '../workflow/database/entities/workflow-run.entity';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import { WorkflowRecoveryCandidatesService } from './workflow-recovery-candidates.service';

describe('WorkflowRecoveryCandidatesService', () => {
  let service: WorkflowRecoveryCandidatesService;
  let workflowRunRepository: {
    findByStatus: ReturnType<typeof vi.fn>;
  };
  let executionRepository: {
    findExpiredOwnerLeases: ReturnType<typeof vi.fn>;
  };
  let stepQueue: {
    getJobs: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    workflowRunRepository = {
      findByStatus: vi.fn().mockResolvedValue([]),
    };
    executionRepository = {
      findExpiredOwnerLeases: vi.fn().mockResolvedValue([]),
    };
    stepQueue = {
      getJobs: vi.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRecoveryCandidatesService,
        {
          provide: WORKFLOW_RUN_REPOSITORY_PORT,
          useValue: workflowRunRepository,
        },
        { provide: ExecutionRepository, useValue: executionRepository },
        { provide: getQueueToken('workflow-steps'), useValue: stepQueue },
      ],
    }).compile();

    service = module.get(WorkflowRecoveryCandidatesService);
  });

  it('reports expired owner lease executions separately from stale running runs', async () => {
    const runningRun = {
      id: 'run-1',
      status: WorkflowStatus.RUNNING,
      updated_at: new Date('2026-06-30T11:55:00.000Z'),
    } as WorkflowRun;
    const expiredExecution = {
      id: 'exec-1',
      state: 'running',
      owner_lease_expires_at: new Date('2026-06-30T11:58:00.000Z'),
    } as ExecutionEntity;

    workflowRunRepository.findByStatus
      .mockResolvedValueOnce([runningRun])
      .mockResolvedValueOnce([]);
    executionRepository.findExpiredOwnerLeases.mockResolvedValueOnce([
      expiredExecution,
    ]);

    const result = await service.inspect({ staleRunningMinutes: 3 });

    expect(executionRepository.findExpiredOwnerLeases).toHaveBeenCalledWith(
      expect.any(Date),
    );
    expect(result.expired_owner_lease_execution_ids).toEqual(['exec-1']);
  });
});
