import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentAwaitEntity } from '../agent-await.entity';
import { AgentAwaitRegistryService } from '../agent-await-registry.service';
import { AgentAwaitRepository } from '../agent-await.repository';
import { DependencyParentResumeService } from '../dependency-parent-resume.service';
import { AgentAwaitChildTerminalListener } from '../agent-await-child-terminal.listener';
import type { WorkflowRunEvent } from '../../workflow-events.types';

type RegistryMock = Pick<AgentAwaitRegistryService, 'onChildTerminal'>;
type ResumeMock = Pick<DependencyParentResumeService, 'resumeParent'>;
type AwaitRepoMock = Pick<AgentAwaitRepository, 'cancelOpenForParentRun'>;

const createAwait = (): AgentAwaitEntity => ({
  id: 'await-1',
  parent_run_id: 'parent-run-1',
  parent_step_id: 'step-1',
  parent_session_tree_id: 'tree-1',
  awaited_run_ids: ['child-1'],
  satisfied_run_ids: [{ runId: 'child-1', status: 'COMPLETED' }],
  status: 'RESUMING',
  resume_node_id: null,
  created_at: new Date('2026-06-12T00:00:00.000Z'),
  updated_at: new Date('2026-06-12T00:00:00.000Z'),
});

const createEvent = (
  overrides: Partial<WorkflowRunEvent> = {},
): WorkflowRunEvent => ({
  workflowRunId: 'child-1',
  workflowId: 'workflow-1',
  status: 'COMPLETED',
  stateVariables: {},
  ...overrides,
});

describe('AgentAwaitChildTerminalListener', () => {
  let registry: RegistryMock;
  let parentResume: ResumeMock;
  let awaitRepo: AwaitRepoMock;
  let listener: AgentAwaitChildTerminalListener;

  beforeEach(() => {
    registry = {
      onChildTerminal: vi.fn().mockResolvedValue({ ready: null }),
    };
    parentResume = {
      resumeParent: vi.fn().mockResolvedValue(undefined),
    };
    awaitRepo = {
      cancelOpenForParentRun: vi.fn().mockResolvedValue(0),
    };
    listener = new AgentAwaitChildTerminalListener(
      registry as AgentAwaitRegistryService,
      parentResume as DependencyParentResumeService,
      awaitRepo as AgentAwaitRepository,
    );
  });

  it('forwards a completed child run to the registry as COMPLETED', async () => {
    await listener.handleRunCompleted(createEvent({ status: 'COMPLETED' }));

    expect(registry.onChildTerminal).toHaveBeenCalledOnce();
    expect(registry.onChildTerminal).toHaveBeenCalledWith(
      'child-1',
      'COMPLETED',
    );
  });

  it('forwards a failed child run to the registry as FAILED', async () => {
    await listener.handleRunFailed(createEvent({ status: 'FAILED' }));

    expect(registry.onChildTerminal).toHaveBeenCalledOnce();
    expect(registry.onChildTerminal).toHaveBeenCalledWith('child-1', 'FAILED');
  });

  it('forwards a cancelled child run to the registry as CANCELLED', async () => {
    await listener.handleRunCancelled(createEvent({ status: 'CANCELLED' }));

    expect(registry.onChildTerminal).toHaveBeenCalledOnce();
    expect(registry.onChildTerminal).toHaveBeenCalledWith(
      'child-1',
      'CANCELLED',
    );
  });

  it('cancels the cancelled run’s own parked awaits so it cannot be resurrected', async () => {
    await listener.handleRunCancelled(
      createEvent({ workflowRunId: 'parent-run-9', status: 'CANCELLED' }),
    );

    expect(awaitRepo.cancelOpenForParentRun).toHaveBeenCalledWith(
      'parent-run-9',
    );
  });

  it('still forwards the child signal even if cancelling parent awaits fails', async () => {
    awaitRepo.cancelOpenForParentRun = vi
      .fn()
      .mockRejectedValue(new Error('db down'));
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(
      listener.handleRunCancelled(createEvent({ status: 'CANCELLED' })),
    ).resolves.toBeUndefined();

    expect(registry.onChildTerminal).toHaveBeenCalledWith(
      'child-1',
      'CANCELLED',
    );
    errorSpy.mockRestore();
  });

  it('does not resume the parent when no await is ready', async () => {
    registry.onChildTerminal = vi.fn().mockResolvedValue({ ready: null });

    await listener.handleRunCompleted(createEvent());

    expect(parentResume.resumeParent).not.toHaveBeenCalled();
  });

  it('resumes the parent exactly once with the ready await', async () => {
    const ready = createAwait();
    registry.onChildTerminal = vi.fn().mockResolvedValue({ ready });

    await listener.handleRunCompleted(createEvent());

    expect(parentResume.resumeParent).toHaveBeenCalledOnce();
    expect(parentResume.resumeParent).toHaveBeenCalledWith(ready);
  });

  it('swallows and logs errors thrown by the registry without rethrowing', async () => {
    const failure = new Error('registry boom');
    registry.onChildTerminal = vi.fn().mockRejectedValue(failure);
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(
      listener.handleRunFailed(createEvent()),
    ).resolves.toBeUndefined();

    expect(parentResume.resumeParent).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0]?.[0]).toContain('registry boom');

    errorSpy.mockRestore();
  });

  it('swallows and logs errors thrown by the parent resume without rethrowing', async () => {
    const ready = createAwait();
    registry.onChildTerminal = vi.fn().mockResolvedValue({ ready });
    parentResume.resumeParent = vi
      .fn()
      .mockRejectedValue(new Error('resume boom'));
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(
      listener.handleRunCompleted(createEvent()),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0]?.[0]).toContain('resume boom');

    errorSpy.mockRestore();
  });
});
