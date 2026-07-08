import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessSessionRef, SatisfiedChild } from '@nexus/core';
import { AgentAwaitEntity } from '../agent-await.entity';
import { AgentAwaitRepository } from '../agent-await.repository';
import { DependencyParentResumeService } from '../dependency-parent-resume.service';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../../kernel/interfaces/workflow-kernel.ports';
import { CHAT_SESSION_DOMAIN_PORT } from '../../domain-ports';
import type { ChatSessionDomainPort } from '../../domain-ports';
import { WorkflowJobMessageQueueService } from '../../workflow-job-message-queue.service';
import { StepEventPublisherService } from '../../workflow-step-execution/step-event-publisher.service';

type AwaitRepoMock = Pick<AgentAwaitRepository, 'compareAndSetStatus'>;
type RunRepoMock = Pick<
  import('../../kernel/interfaces/workflow-kernel.ports').IWorkflowRunRepository,
  'clearWaitState' | 'findById'
>;
type SessionMock = Pick<
  ChatSessionDomainPort,
  'appendSystemResultNode' | 'findSessionTreeByWorkflowRunId'
>;
type QueueMock = Pick<WorkflowJobMessageQueueService, 'resumeJobWithMessage'>;
type PublisherMock = Pick<StepEventPublisherService, 'publishProcessEvent'>;

const createAwait = (
  overrides: Partial<AgentAwaitEntity> = {},
): AgentAwaitEntity => ({
  id: 'await-1',
  parent_run_id: 'parent-run-1',
  parent_step_id: 'step-1',
  parent_session_tree_id: 'tree-1',
  awaited_run_ids: ['child-1', 'child-2'],
  satisfied_run_ids: [
    { runId: 'child-1', status: 'COMPLETED' },
    { runId: 'child-2', status: 'FAILED' },
  ] as SatisfiedChild[],
  status: 'RESUMING',
  resume_node_id: null,
  created_at: new Date('2026-06-12T00:00:00.000Z'),
  updated_at: new Date('2026-06-12T00:00:00.000Z'),
  ...overrides,
});

describe('DependencyParentResumeService', () => {
  let awaitRepo: AwaitRepoMock;
  let runRepo: RunRepoMock;
  let session: SessionMock;
  let queue: QueueMock;
  let publisher: PublisherMock;
  let service: DependencyParentResumeService;

  beforeEach(async () => {
    awaitRepo = {
      compareAndSetStatus: vi.fn().mockResolvedValue(true),
    };
    runRepo = {
      clearWaitState: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn().mockResolvedValue(null),
    };
    session = {
      appendSystemResultNode: vi.fn().mockResolvedValue('node-id'),
      findSessionTreeByWorkflowRunId: vi.fn().mockResolvedValue(null),
    };
    queue = {
      resumeJobWithMessage: vi.fn().mockResolvedValue('job-1'),
    };
    publisher = {
      publishProcessEvent: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DependencyParentResumeService,
        { provide: AgentAwaitRepository, useValue: awaitRepo },
        { provide: WORKFLOW_RUN_REPOSITORY_PORT, useValue: runRepo },
        { provide: CHAT_SESSION_DOMAIN_PORT, useValue: session },
        { provide: WorkflowJobMessageQueueService, useValue: queue },
        { provide: StepEventPublisherService, useValue: publisher },
      ],
    }).compile();

    service = module.get(DependencyParentResumeService);
  });

  it('appends one system result node per satisfied child into the parent session tree', async () => {
    await service.resumeParent(createAwait());

    expect(session.appendSystemResultNode).toHaveBeenCalledTimes(2);
    const treeIds = (
      session.appendSystemResultNode as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0]);
    expect(treeIds).toEqual(['tree-1', 'tree-1']);
  });

  it('includes the child run id, status, and result detail in each appended node', async () => {
    (runRepo.findById as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: 'child-1',
        state_variables: { result: 'all green' },
      })
      .mockResolvedValueOnce(null);

    await service.resumeParent(createAwait());

    const firstContent = (
      session.appendSystemResultNode as ReturnType<typeof vi.fn>
    ).mock.calls[0][1] as string;
    expect(firstContent).toContain('child-1');
    expect(firstContent).toContain('COMPLETED');
    expect(firstContent).toContain('all green');
  });

  it('clears the parent wait state', async () => {
    await service.resumeParent(createAwait());

    expect(runRepo.clearWaitState).toHaveBeenCalledWith('parent-run-1');
  });

  it('re-enqueues the parent run exactly once with a join summary message', async () => {
    await service.resumeParent(createAwait());

    expect(queue.resumeJobWithMessage).toHaveBeenCalledTimes(1);
    const [runId, treeId, message] = (
      queue.resumeJobWithMessage as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(runId).toBe('parent-run-1');
    expect(treeId).toBe('tree-1');
    expect(message).toContain('child-1');
    expect(message).toContain('COMPLETED');
    expect(message).toContain('child-2');
    expect(message).toContain('FAILED');
  });

  it('prefers the freshest session tree resolved at resume time over the stored id', async () => {
    (
      session.findSessionTreeByWorkflowRunId as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'tree-fresh' });

    await service.resumeParent(createAwait());

    expect(session.findSessionTreeByWorkflowRunId).toHaveBeenCalledWith(
      'parent-run-1',
    );
    const treeIds = (
      session.appendSystemResultNode as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0]);
    expect(treeIds).toEqual(['tree-fresh', 'tree-fresh']);
    const [, resumeTreeId] = (
      queue.resumeJobWithMessage as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(resumeTreeId).toBe('tree-fresh');
  });

  it('falls back to the stored parent_session_tree_id when no fresher tree exists', async () => {
    await service.resumeParent(createAwait());

    const [, resumeTreeId] = (
      queue.resumeJobWithMessage as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(resumeTreeId).toBe('tree-1');
  });

  it('resumes when only a freshly-resolved tree exists and the stored id is null', async () => {
    (
      session.findSessionTreeByWorkflowRunId as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'tree-fresh' });

    await service.resumeParent(createAwait({ parent_session_tree_id: null }));

    const [, resumeTreeId] = (
      queue.resumeJobWithMessage as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(resumeTreeId).toBe('tree-fresh');
  });

  it('promotes the await from RESUMING to RESUMED on success', async () => {
    await service.resumeParent(createAwait());

    expect(awaitRepo.compareAndSetStatus).toHaveBeenCalledWith(
      'await-1',
      'RESUMING',
      'RESUMED',
    );
  });

  it('emits resume_started before and resumed after', async () => {
    await service.resumeParent(createAwait());

    const eventTypes = (
      publisher.publishProcessEvent as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[1]);
    expect(eventTypes).toContain('agent_await.resume_started');
    expect(eventTypes).toContain('agent_await.resumed');
    expect(eventTypes.indexOf('agent_await.resume_started')).toBeLessThan(
      eventTypes.indexOf('agent_await.resumed'),
    );
  });

  it('forwards parent_session_ref to the queue as the resume session ref', async () => {
    const ref: HarnessSessionRef = {
      kind: 'claude_code',
      sessionId: 'sdk-session-xyz',
    };

    await service.resumeParent(createAwait({ parent_session_ref: ref }));

    const call = (queue.resumeJobWithMessage as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call[3]).toEqual({ resumeSessionRef: ref });
  });

  it('passes undefined as resume session ref when parent_session_ref is absent', async () => {
    await service.resumeParent(createAwait({ parent_session_ref: null }));

    const call = (queue.resumeJobWithMessage as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call[3]).toBeUndefined();
  });

  it('resumes a tree-less claude_code parent via parent_session_ref', async () => {
    const ref: HarnessSessionRef = {
      kind: 'claude_code',
      sessionId: 'sdk-session-treeless',
    };

    await service.resumeParent(
      createAwait({ parent_session_tree_id: null, parent_session_ref: ref }),
    );

    // No PI session tree exists, so no tree nodes are appended...
    expect(session.appendSystemResultNode).not.toHaveBeenCalled();

    // ...but the parent is still re-enqueued, carrying the engine session ref
    // and no tree id, and the await is promoted to RESUMED.
    expect(queue.resumeJobWithMessage).toHaveBeenCalledTimes(1);
    const call = (queue.resumeJobWithMessage as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call[1]).toBeUndefined();
    expect(call[3]).toEqual({ resumeSessionRef: ref });
    expect(awaitRepo.compareAndSetStatus).toHaveBeenCalledWith(
      'await-1',
      'RESUMING',
      'RESUMED',
    );
  });

  it('inlines each child outcome into the join message when there is no session tree', async () => {
    (runRepo.findById as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: 'child-1',
        state_variables: { result: 'all green' },
      })
      .mockResolvedValueOnce(null);

    await service.resumeParent(
      createAwait({
        parent_session_tree_id: null,
        parent_session_ref: { kind: 'claude_code', sessionId: 's' },
      }),
    );

    const message = (queue.resumeJobWithMessage as ReturnType<typeof vi.fn>)
      .mock.calls[0][2] as string;
    expect(message).toContain('child-1');
    expect(message).toContain('COMPLETED');
    expect(message).toContain('all green');
    expect(message).toContain('child-2');
    expect(message).toContain('FAILED');
  });

  it('does NOT mark RESUMED and rethrows when re-enqueue fails', async () => {
    const failure = new Error('queue down');
    (queue.resumeJobWithMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      failure,
    );

    await expect(service.resumeParent(createAwait())).rejects.toThrow(
      'queue down',
    );

    expect(awaitRepo.compareAndSetStatus).not.toHaveBeenCalled();
  });

  it('emits agent_await.failed and throws when neither a session tree nor a session ref is available', async () => {
    await expect(
      service.resumeParent(
        createAwait({
          parent_session_tree_id: null,
          parent_session_ref: null,
        }),
      ),
    ).rejects.toThrow();

    const eventTypes = (
      publisher.publishProcessEvent as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[1]);
    expect(eventTypes).toContain('agent_await.failed');
    expect(session.appendSystemResultNode).not.toHaveBeenCalled();
    expect(queue.resumeJobWithMessage).not.toHaveBeenCalled();
    expect(awaitRepo.compareAndSetStatus).not.toHaveBeenCalled();
  });
});
