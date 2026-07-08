import { describe, expect, it, vi } from 'vitest';
import { QuestionIdleContainerListener } from './question-idle-container.listener';

function buildListener(overrides?: { openRuns?: string[] }) {
  const tracker = {
    registerCallbacks: vi.fn(),
    trackQuestionsPosed: vi.fn().mockResolvedValue(undefined),
    isTracking: vi.fn().mockReturnValue(false),
  };
  const container = {
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const docker = {
    getContainer: vi.fn().mockReturnValue(container),
    listContainers: vi.fn().mockResolvedValue([
      {
        Id: 'c-1',
        State: 'running',
        Labels: { 'nexus.workflow_run_id': 'run-1' },
        Created: 1,
      },
    ]),
  };
  const questionAwaitRepo = {
    findRunIdsWithOpenQuestions: vi
      .fn()
      .mockResolvedValue(new Set(overrides?.openRuns ?? [])),
  };
  const listener = new QuestionIdleContainerListener(
    tracker as never,
    docker,
    questionAwaitRepo as never,
  );
  return { listener, tracker, docker, container };
}

describe('QuestionIdleContainerListener', () => {
  it('registers stop/remove callbacks on module init', () => {
    const { listener, tracker } = buildListener();

    listener.onModuleInit();

    expect(tracker.registerCallbacks).toHaveBeenCalledWith({
      onStop: expect.any(Function),
      onRemove: expect.any(Function),
    });
  });

  it('onStop stops the waiting container', async () => {
    const { listener, tracker, container } = buildListener();
    listener.onModuleInit();
    const callbacks = tracker.registerCallbacks.mock.calls[0][0];

    await callbacks.onStop('run-1', 'c-1');

    expect(container.stop).toHaveBeenCalled();
  });

  it('onRemove removes the waiting container', async () => {
    const { listener, tracker, container } = buildListener();
    listener.onModuleInit();
    const callbacks = tracker.registerCallbacks.mock.calls[0][0];

    await callbacks.onRemove('run-1', 'c-1');

    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  it('re-arms tracking for runs with open questions on bootstrap', async () => {
    const { listener, tracker } = buildListener({ openRuns: ['run-1'] });

    await listener.onApplicationBootstrap();

    expect(tracker.trackQuestionsPosed).toHaveBeenCalledWith('run-1', 'c-1');
  });

  it('does not re-arm runs without open questions', async () => {
    const { listener, tracker } = buildListener({ openRuns: [] });

    await listener.onApplicationBootstrap();

    expect(tracker.trackQuestionsPosed).not.toHaveBeenCalled();
  });

  it('does not re-arm a run that is already being tracked', async () => {
    const { listener, tracker } = buildListener({ openRuns: ['run-1'] });
    tracker.isTracking.mockReturnValue(true);

    await listener.onApplicationBootstrap();

    expect(tracker.trackQuestionsPosed).not.toHaveBeenCalled();
  });

  it('lists only running managed containers when re-arming', async () => {
    const { listener, docker } = buildListener({ openRuns: ['run-1'] });

    await listener.onApplicationBootstrap();

    expect(docker.listContainers).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          label: ['nexus.managed=true'],
          status: ['running'],
        }),
      }),
    );
  });
});
