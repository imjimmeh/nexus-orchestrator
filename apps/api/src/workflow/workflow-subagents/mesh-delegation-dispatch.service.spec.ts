import { describe, expect, it, vi } from 'vitest';
import type { DelegationContractRepository } from '../database/repositories/delegation-contract.repository';
import { MeshDelegationAuditPublisherService } from './mesh-delegation-audit-publisher.service';
import { MeshDelegationCandidateQueryService } from './mesh-delegation-candidate-query.service';
import { MeshDelegationCapacityPolicyService } from './mesh-delegation-capacity-policy.service';
import { MeshDelegationDispatchExecutorService } from './mesh-delegation-dispatch-executor.service';
import { MeshDelegationDispatchService } from './mesh-delegation-dispatch.service';
import { MeshDelegationStatusUpdaterService } from './mesh-delegation-status-updater.service';

function createContract(id: string) {
  return {
    id,
    workflow_run_id: 'run-1',
    parent_container_id: 'parent-1',
    requester_agent_profile: 'architect-agent',
    status: 'queued',
    trace_id: `${id}-trace`,
    queue_priority: 100,
    attempt_count: 0,
    max_retries: 1,
    subagent_execution_id: null,
  };
}

describe('MeshDelegationDispatchService', () => {
  const countByParentAndStatus = vi.fn();
  const delegationRepo = {
    countByParentAndStatus,
  } as unknown as DelegationContractRepository;

  const ensureQueueDepthWithinLimit = vi.fn();
  const resolveAvailableSlots = vi.fn();
  const countQueuedContracts = vi.fn();
  const countRunningContracts = vi.fn();
  const resolveMaxConcurrentDelegations = vi.fn();
  const capacityPolicy = {
    ensureQueueDepthWithinLimit,
    resolveAvailableSlots,
    countQueuedContracts,
    countRunningContracts,
    resolveMaxConcurrentDelegations,
  } as unknown as MeshDelegationCapacityPolicyService;

  const resolveLineage = vi.fn();
  const findQueuedContracts = vi.fn();
  const findExpiredContracts = vi.fn();
  const candidateQuery = {
    resolveLineage,
    findQueuedContracts,
    findExpiredContracts,
  } as unknown as MeshDelegationCandidateQueryService;

  const requeueTimedOutContract = vi.fn();
  const markTimedOutContract = vi.fn();
  const statusUpdater = {
    requeueTimedOutContract,
    markTimedOutContract,
  } as unknown as MeshDelegationStatusUpdaterService;

  const dispatchContract = vi.fn();
  const dispatchExecutor = {
    dispatchContract,
  } as unknown as MeshDelegationDispatchExecutorService;

  const appendLifecycleEvent = vi.fn();
  const auditPublisher = {
    appendLifecycleEvent,
  } as unknown as MeshDelegationAuditPublisherService;

  const service = new MeshDelegationDispatchService(
    delegationRepo,
    candidateQuery,
    capacityPolicy,
    statusUpdater,
    dispatchExecutor,
    auditPublisher,
  );

  it('delegates queue depth checks to capacity policy', async () => {
    ensureQueueDepthWithinLimit.mockResolvedValue(undefined);

    await service.ensureQueueDepthWithinLimit('run-1', 'parent-1');

    expect(ensureQueueDepthWithinLimit).toHaveBeenCalledWith(
      'run-1',
      'parent-1',
    );
  });

  it('delegates lineage resolution to candidate query', async () => {
    const lineage = {
      traceId: 'trace-1',
      parentTraceId: null,
      lineageDepth: 0,
      lineagePath: ['trace-1'],
    };
    resolveLineage.mockResolvedValue(lineage);

    const result = await service.resolveLineage({
      parentDelegationId: null,
      parentTraceId: null,
    });

    expect(result).toEqual(lineage);
  });

  it('returns backpressure result when no slots are available', async () => {
    resolveAvailableSlots.mockResolvedValue({
      runningCount: 2,
      maxConcurrent: 2,
      availableSlots: 0,
    });
    countQueuedContracts.mockResolvedValue(3);
    countRunningContracts.mockResolvedValue(2);
    resolveMaxConcurrentDelegations.mockResolvedValue(2);

    const result = await service.dispatchQueuedDelegations({
      workflowRunId: 'run-1',
      parentContainerId: 'parent-1',
      lifecycleStage: null,
      spawnHandler: vi.fn(),
    });

    expect(result.backpressure).toBe(true);
    expect(result.dispatchedContractIds).toEqual([]);
    expect(result.failedContractIds).toEqual([]);
    expect(findQueuedContracts).not.toHaveBeenCalled();
  });

  it('dispatches queued contracts through dispatch executor', async () => {
    const contractA = createContract('contract-a');
    const contractB = createContract('contract-b');

    resolveAvailableSlots.mockResolvedValue({
      runningCount: 0,
      maxConcurrent: 2,
      availableSlots: 2,
    });
    findQueuedContracts.mockResolvedValue([contractA, contractB]);
    dispatchContract.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    countQueuedContracts.mockResolvedValue(1);
    countRunningContracts.mockResolvedValue(1);
    resolveMaxConcurrentDelegations.mockResolvedValue(2);

    const result = await service.dispatchQueuedDelegations({
      workflowRunId: 'run-1',
      parentContainerId: 'parent-1',
      lifecycleStage: null,
      spawnHandler: vi.fn(),
    });

    expect(dispatchContract).toHaveBeenCalledTimes(2);
    expect(result.dispatchedContractIds).toEqual(['contract-a']);
    expect(result.failedContractIds).toEqual(['contract-b']);
    expect(result.backpressure).toBe(false);
  });

  it('sweeps timed-out contracts and updates status through status updater', async () => {
    const queuedContract = {
      ...createContract('contract-queued'),
      status: 'queued',
      attempt_count: 0,
      max_retries: 1,
    };
    const runningContract = {
      ...createContract('contract-running'),
      status: 'running',
      subagent_execution_id: 'sub-1',
      attempt_count: 2,
      max_retries: 1,
    };

    findExpiredContracts.mockResolvedValue([queuedContract, runningContract]);
    const cancelHandler = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const result = await service.sweepTimedOutDelegations({
      workflowRunId: 'run-1',
      cancelHandler,
    });

    expect(requeueTimedOutContract).toHaveBeenCalledWith('contract-queued');
    expect(markTimedOutContract).toHaveBeenCalledWith('contract-running');
    expect(result.requeuedContractIds).toEqual(['contract-queued']);
    expect(result.timedOutContractIds).toEqual(['contract-running']);
  });
});
