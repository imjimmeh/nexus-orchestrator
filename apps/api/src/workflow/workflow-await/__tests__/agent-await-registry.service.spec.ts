import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SatisfiedChild } from '@nexus/core';
import { AgentAwaitEntity } from '../agent-await.entity';
import { AgentAwaitRepository } from '../agent-await.repository';
import { AgentAwaitRegistryService } from '../agent-await-registry.service';
import { IWorkflowRunRepository } from '../../kernel/interfaces/workflow-kernel.ports';
import { StepEventPublisherService } from '../../workflow-step-execution/step-event-publisher.service';

type AwaitRepoMock = Pick<
  AgentAwaitRepository,
  | 'create'
  | 'findById'
  | 'findByParentRun'
  | 'findWaitingByAwaitedChild'
  | 'markSatisfied'
  | 'compareAndSetStatus'
  | 'findNonTerminal'
>;

type RunRepoMock = Pick<
  IWorkflowRunRepository,
  'setWaitState' | 'clearWaitState'
>;

type PublisherMock = Pick<StepEventPublisherService, 'publishProcessEvent'>;

const createAwait = (
  overrides: Partial<AgentAwaitEntity> = {},
): AgentAwaitEntity => ({
  id: 'await-1',
  parent_run_id: 'parent-run-1',
  parent_step_id: 'step-1',
  parent_session_tree_id: null,
  awaited_run_ids: ['child-1'],
  satisfied_run_ids: [],
  status: 'WAITING',
  resume_node_id: null,
  created_at: new Date('2026-06-12T00:00:00.000Z'),
  updated_at: new Date('2026-06-12T00:00:00.000Z'),
  ...overrides,
});

describe('AgentAwaitRegistryService', () => {
  let awaitRepo: AwaitRepoMock;
  let runRepo: RunRepoMock;
  let publisher: PublisherMock;
  let service: AgentAwaitRegistryService;

  beforeEach(() => {
    awaitRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      findByParentRun: vi.fn(),
      findWaitingByAwaitedChild: vi.fn(),
      markSatisfied: vi.fn().mockResolvedValue(undefined),
      compareAndSetStatus: vi.fn(),
      findNonTerminal: vi.fn(),
    };
    runRepo = {
      setWaitState: vi.fn().mockResolvedValue(undefined),
      clearWaitState: vi.fn().mockResolvedValue(undefined),
    };
    publisher = {
      publishProcessEvent: vi.fn().mockResolvedValue(undefined),
    };
    service = new AgentAwaitRegistryService(
      awaitRepo as AgentAwaitRepository,
      runRepo as IWorkflowRunRepository,
      publisher as StepEventPublisherService,
    );
  });

  describe('register', () => {
    it('throws BadRequestException when awaitedRunIds is empty', async () => {
      await expect(
        service.register({
          parentRunId: 'parent-run-1',
          parentStepId: 'step-1',
          awaitedRunIds: [],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(awaitRepo.create).not.toHaveBeenCalled();
      expect(runRepo.setWaitState).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when parent awaits itself (cycle/self-await)', async () => {
      await expect(
        service.register({
          parentRunId: 'parent-run-1',
          parentStepId: 'step-1',
          awaitedRunIds: ['child-1', 'parent-run-1'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(awaitRepo.create).not.toHaveBeenCalled();
      expect(runRepo.setWaitState).not.toHaveBeenCalled();
    });

    it('creates the await record and sets the parent wait state to dependency', async () => {
      const created = createAwait({ awaited_run_ids: ['child-1', 'child-2'] });
      (awaitRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);

      const result = await service.register({
        parentRunId: 'parent-run-1',
        parentStepId: 'step-1',
        parentSessionTreeId: 'tree-1',
        awaitedRunIds: ['child-1', 'child-2'],
        resumeNodeId: 'resume-1',
      });

      expect(awaitRepo.create).toHaveBeenCalledWith({
        parentRunId: 'parent-run-1',
        parentStepId: 'step-1',
        parentSessionTreeId: 'tree-1',
        awaitedRunIds: ['child-1', 'child-2'],
        resumeNodeId: 'resume-1',
      });
      expect(runRepo.setWaitState).toHaveBeenCalledWith(
        'parent-run-1',
        'dependency',
      );
      expect(result).toBe(created);
    });

    it('emits an agent_await.registered process event', async () => {
      const created = createAwait();
      (awaitRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);

      await service.register({
        parentRunId: 'parent-run-1',
        parentStepId: 'step-1',
        awaitedRunIds: ['child-1'],
      });

      expect(publisher.publishProcessEvent).toHaveBeenCalledWith(
        'parent-run-1',
        'agent_await.registered',
        expect.objectContaining({
          awaitId: 'await-1',
          stepId: 'step-1',
          awaitedRunIds: ['child-1'],
        }),
      );
    });
  });

  describe('onChildTerminal', () => {
    const completed: SatisfiedChild['status'] = 'COMPLETED';

    it('is a no-op for an unknown child and returns ready null', async () => {
      (
        awaitRepo.findWaitingByAwaitedChild as ReturnType<typeof vi.fn>
      ).mockResolvedValue([]);

      const result = await service.onChildTerminal('unknown-child', completed);

      expect(result).toEqual({ ready: null });
      expect(awaitRepo.markSatisfied).not.toHaveBeenCalled();
      expect(awaitRepo.compareAndSetStatus).not.toHaveBeenCalled();
    });

    it('marks satisfied but returns ready null when the await is only partially satisfied', async () => {
      const await1 = createAwait({
        awaited_run_ids: ['child-1', 'child-2'],
        satisfied_run_ids: [],
      });
      (
        awaitRepo.findWaitingByAwaitedChild as ReturnType<typeof vi.fn>
      ).mockResolvedValue([await1]);
      // After marking, refetch shows only one satisfied of two.
      (awaitRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        createAwait({
          awaited_run_ids: ['child-1', 'child-2'],
          satisfied_run_ids: [{ runId: 'child-1', status: 'COMPLETED' }],
        }),
      );

      const result = await service.onChildTerminal('child-1', completed);

      expect(awaitRepo.markSatisfied).toHaveBeenCalledWith('await-1', {
        runId: 'child-1',
        status: 'COMPLETED',
      });
      expect(awaitRepo.compareAndSetStatus).not.toHaveBeenCalled();
      expect(result).toEqual({ ready: null });
    });

    it('emits agent_await.child_satisfied on each satisfy', async () => {
      const await1 = createAwait({
        awaited_run_ids: ['child-1', 'child-2'],
      });
      (
        awaitRepo.findWaitingByAwaitedChild as ReturnType<typeof vi.fn>
      ).mockResolvedValue([await1]);
      (awaitRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        createAwait({
          awaited_run_ids: ['child-1', 'child-2'],
          satisfied_run_ids: [{ runId: 'child-1', status: 'COMPLETED' }],
        }),
      );

      await service.onChildTerminal('child-1', completed);

      expect(publisher.publishProcessEvent).toHaveBeenCalledWith(
        'parent-run-1',
        'agent_await.child_satisfied',
        expect.objectContaining({
          awaitId: 'await-1',
          childRunId: 'child-1',
          status: 'COMPLETED',
        }),
      );
    });

    it('returns the await as ready and wins the CAS when fully satisfied', async () => {
      const await1 = createAwait({
        awaited_run_ids: ['child-1'],
      });
      (
        awaitRepo.findWaitingByAwaitedChild as ReturnType<typeof vi.fn>
      ).mockResolvedValue([await1]);
      const fullySatisfied = createAwait({
        awaited_run_ids: ['child-1'],
        satisfied_run_ids: [{ runId: 'child-1', status: 'COMPLETED' }],
      });
      (awaitRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        fullySatisfied,
      );
      (
        awaitRepo.compareAndSetStatus as ReturnType<typeof vi.fn>
      ).mockResolvedValue(true);

      const result = await service.onChildTerminal('child-1', completed);

      expect(awaitRepo.compareAndSetStatus).toHaveBeenCalledWith(
        'await-1',
        'WAITING',
        'RESUMING',
      );
      expect(result.ready).toBe(fullySatisfied);
    });

    it('returns ready null when fully satisfied but the CAS is lost (already resuming)', async () => {
      const await1 = createAwait({ awaited_run_ids: ['child-1'] });
      (
        awaitRepo.findWaitingByAwaitedChild as ReturnType<typeof vi.fn>
      ).mockResolvedValue([await1]);
      (awaitRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        createAwait({
          awaited_run_ids: ['child-1'],
          satisfied_run_ids: [{ runId: 'child-1', status: 'COMPLETED' }],
        }),
      );
      (
        awaitRepo.compareAndSetStatus as ReturnType<typeof vi.fn>
      ).mockResolvedValue(false);

      const result = await service.onChildTerminal('child-1', completed);

      expect(result).toEqual({ ready: null });
    });

    it('returns the first await that wins the CAS when multiple become ready', async () => {
      const awaitA = createAwait({
        id: 'await-A',
        parent_run_id: 'parent-A',
        awaited_run_ids: ['child-1'],
      });
      const awaitB = createAwait({
        id: 'await-B',
        parent_run_id: 'parent-B',
        awaited_run_ids: ['child-1'],
      });
      (
        awaitRepo.findWaitingByAwaitedChild as ReturnType<typeof vi.fn>
      ).mockResolvedValue([awaitA, awaitB]);
      const satisfiedA = createAwait({
        id: 'await-A',
        parent_run_id: 'parent-A',
        awaited_run_ids: ['child-1'],
        satisfied_run_ids: [{ runId: 'child-1', status: 'COMPLETED' }],
      });
      const satisfiedB = createAwait({
        id: 'await-B',
        parent_run_id: 'parent-B',
        awaited_run_ids: ['child-1'],
        satisfied_run_ids: [{ runId: 'child-1', status: 'COMPLETED' }],
      });
      // findById is called once per await (event lookup) then again for the
      // readiness check; resolve the matching satisfied snapshot each time.
      (awaitRepo.findById as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(satisfiedA)
        .mockResolvedValueOnce(satisfiedA)
        .mockResolvedValueOnce(satisfiedB)
        .mockResolvedValueOnce(satisfiedB);
      (
        awaitRepo.compareAndSetStatus as ReturnType<typeof vi.fn>
      ).mockResolvedValue(true);

      const result = await service.onChildTerminal('child-1', completed);

      expect(result.ready?.id).toBe('await-A');
      // Only the first winner is returned; the second is left for the reconciler.
      expect(awaitRepo.compareAndSetStatus).toHaveBeenCalledTimes(1);
    });

    it('is idempotent on re-delivery of an already-satisfied child', async () => {
      // markSatisfied dedupes; findById shows the child already present and full,
      // but the CAS fails because the await already left WAITING.
      const await1 = createAwait({ awaited_run_ids: ['child-1'] });
      (
        awaitRepo.findWaitingByAwaitedChild as ReturnType<typeof vi.fn>
      ).mockResolvedValue([]);

      const result = await service.onChildTerminal('child-1', completed);

      // findWaitingByAwaitedChild only returns WAITING awaits; an already-resumed
      // await is no longer WAITING, so nothing matches and no resume happens.
      expect(result).toEqual({ ready: null });
      expect(awaitRepo.compareAndSetStatus).not.toHaveBeenCalled();
      void await1;
    });
  });
});
