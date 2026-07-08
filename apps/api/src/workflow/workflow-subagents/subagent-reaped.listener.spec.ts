import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Docker from 'dockerode';
import type { DomainEventEnvelope } from '../../domain-events/domain-event-bus.types';
import type { InProcessDomainEventBus } from '../../domain-events/in-process-domain-event.bus';
import type { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import type { ExecutionEntity } from '../../execution-lifecycle/database/entities/execution.entity';
import { EXECUTION_EVENT_TYPES } from '../../execution-lifecycle/execution-lifecycle.contracts';
import type { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';
import type { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import type { MeshDelegationService } from './mesh-delegation.service';
import { SubagentReapedListener } from './subagent-reaped.listener';

function buildEnvelope(
  overrides: Partial<DomainEventEnvelope> = {},
): DomainEventEnvelope {
  return {
    eventId: 'event-1',
    eventType: EXECUTION_EVENT_TYPES.reaped,
    aggregateId: 'exec-1',
    aggregateType: 'execution',
    payload: {
      failure_reason: 'container_lost',
      error_message: 'Container vanished',
    },
    occurredAt: new Date(),
    ...overrides,
  };
}

function buildExecutionRow(
  overrides: Partial<ExecutionEntity> = {},
): ExecutionEntity {
  return {
    id: 'exec-1',
    kind: 'subagent',
    state: 'reaped',
    container_id: 'child-1',
    ...overrides,
  } as unknown as ExecutionEntity;
}

describe('SubagentReapedListener', () => {
  const onMock = vi.fn();
  const executionFindByIdMock = vi.fn();
  const subagentDetailsUpsertMock = vi.fn();
  const handleSubagentCancellationMock = vi.fn();
  const logsMock = vi.fn();
  const getContainerMock = vi.fn(() => ({ logs: logsMock }));
  const removeContainerMock = vi.fn();

  const bus = { on: onMock } as unknown as InProcessDomainEventBus;
  const executionRepo = {
    findById: executionFindByIdMock,
  } as unknown as ExecutionRepository;
  const subagentDetailsRepo = {
    upsert: subagentDetailsUpsertMock,
  } as unknown as SubagentDetailsRepository;
  const meshDelegation = {
    handleSubagentCancellation: handleSubagentCancellationMock,
  } as unknown as MeshDelegationService;
  const docker = { getContainer: getContainerMock } as unknown as Docker;
  const containerOrchestrator = {
    removeContainer: removeContainerMock,
  } as unknown as ContainerOrchestratorService;

  let listener: SubagentReapedListener;

  beforeEach(() => {
    vi.clearAllMocks();
    logsMock.mockResolvedValue(Buffer.from('runner boot failed'));
    handleSubagentCancellationMock.mockResolvedValue(null);
    removeContainerMock.mockResolvedValue(undefined);
    listener = new SubagentReapedListener(
      bus,
      executionRepo,
      subagentDetailsRepo,
      meshDelegation,
      docker,
      containerOrchestrator,
    );
    Logger.overrideLogger(false);
  });

  it('subscribes to execution.reaped on module init', () => {
    listener.onModuleInit();

    expect(onMock).toHaveBeenCalledWith(
      EXECUTION_EVENT_TYPES.reaped,
      expect.any(Function),
    );
  });

  it('ignores non-subagent execution kinds', async () => {
    executionFindByIdMock.mockResolvedValue(
      buildExecutionRow({ kind: 'workflow_step' }),
    );

    await listener.onExecutionReaped(buildEnvelope());

    expect(subagentDetailsUpsertMock).not.toHaveBeenCalled();
    expect(handleSubagentCancellationMock).not.toHaveBeenCalled();
  });

  it('ignores a reaped event with no matching execution row', async () => {
    executionFindByIdMock.mockResolvedValue(null);

    await listener.onExecutionReaped(buildEnvelope());

    expect(subagentDetailsUpsertMock).not.toHaveBeenCalled();
  });

  it('ignores a subagent already terminal before this reap (completed)', async () => {
    executionFindByIdMock.mockResolvedValue(
      buildExecutionRow({ state: 'completed' }),
    );

    await listener.onExecutionReaped(buildEnvelope());

    expect(subagentDetailsUpsertMock).not.toHaveBeenCalled();
    expect(handleSubagentCancellationMock).not.toHaveBeenCalled();
  });

  it('ignores a subagent already failed before this reap', async () => {
    executionFindByIdMock.mockResolvedValue(
      buildExecutionRow({ state: 'failed' }),
    );

    await listener.onExecutionReaped(buildEnvelope());

    expect(subagentDetailsUpsertMock).not.toHaveBeenCalled();
  });

  it('writes the Failed result with diagnostics to the satellite and calls mesh-cancel', async () => {
    executionFindByIdMock.mockResolvedValue(buildExecutionRow());

    await listener.onExecutionReaped(buildEnvelope());

    expect(handleSubagentCancellationMock).toHaveBeenCalledWith({
      subagentExecutionId: 'exec-1',
      reason: 'container_lost',
    });
    expect(subagentDetailsUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        execution_id: 'exec-1',
        result: expect.objectContaining({
          status: 'Failed',
          failure_reason: 'container_lost',
          error: 'Container vanished',
          reaped_at: expect.any(String),
          container_diagnostics: expect.objectContaining({
            child_container_id: 'child-1',
            logs_tail: 'runner boot failed',
          }),
        }),
      }),
    );
  });

  it('tolerates a missing/gone child container without throwing', async () => {
    executionFindByIdMock.mockResolvedValue(buildExecutionRow());
    logsMock.mockRejectedValue(new Error('no such container'));

    await expect(
      listener.onExecutionReaped(buildEnvelope()),
    ).resolves.toBeUndefined();

    const updatePayload = subagentDetailsUpsertMock.mock.calls[0][0] as {
      result: { container_diagnostics: { logs_tail: string } };
    };
    expect(updatePayload.result.container_diagnostics.logs_tail).toBe(
      'Failed to collect logs: no such container',
    );
    expect(handleSubagentCancellationMock).toHaveBeenCalled();
  });

  it('force-removes the reaped child container so it stops occupying a cap slot', async () => {
    executionFindByIdMock.mockResolvedValue(buildExecutionRow());

    await listener.onExecutionReaped(buildEnvelope());

    expect(removeContainerMock).toHaveBeenCalledWith('child-1');
  });

  it('does not attempt removal when the reaped execution had no child container', async () => {
    executionFindByIdMock.mockResolvedValue(
      buildExecutionRow({ container_id: null }),
    );

    await listener.onExecutionReaped(buildEnvelope());

    expect(removeContainerMock).not.toHaveBeenCalled();
  });

  it('still completes the reap when container removal fails', async () => {
    executionFindByIdMock.mockResolvedValue(buildExecutionRow());
    removeContainerMock.mockRejectedValue(new Error('already gone'));

    await expect(
      listener.onExecutionReaped(buildEnvelope()),
    ).resolves.toBeUndefined();

    expect(handleSubagentCancellationMock).toHaveBeenCalled();
  });

  it('records null diagnostics when there is no child container', async () => {
    executionFindByIdMock.mockResolvedValue(
      buildExecutionRow({ container_id: null }),
    );

    await listener.onExecutionReaped(buildEnvelope());

    const updatePayload = subagentDetailsUpsertMock.mock.calls[0][0] as {
      result: { container_diagnostics: unknown };
    };
    expect(updatePayload.result.container_diagnostics).toBeNull();
  });

  it('never throws into the bus when persistence fails', async () => {
    executionFindByIdMock.mockResolvedValue(buildExecutionRow());
    subagentDetailsUpsertMock.mockRejectedValue(new Error('db down'));

    await expect(
      listener.onExecutionReaped(buildEnvelope()),
    ).resolves.toBeUndefined();
  });
});
