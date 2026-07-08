import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowRunSteeringService } from './workflow-run-steering.service';

describe('WorkflowRunSteeringService', () => {
  const workflowEngine = {
    cancelWorkflowRun: vi.fn().mockResolvedValue(undefined),
    resumeJobWithMessage: vi.fn().mockResolvedValue('job-1'),
  };

  const workflowPersistence = {
    getWorkflowRun: vi.fn().mockResolvedValue({ id: 'run-1' }),
  };

  const streamService = {
    persistEvent: vi.fn().mockResolvedValue(undefined),
  };

  const pubsubService = {
    publishEvent: vi.fn().mockResolvedValue(undefined),
  };

  const containerApi = {
    pause: vi.fn().mockResolvedValue(undefined),
    unpause: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
  };

  const docker = {
    listContainers: vi.fn(),
    getContainer: vi.fn().mockReturnValue(containerApi),
  } as unknown as any;

  const telemetryGateway = {
    sendPromptCommand: vi.fn().mockResolvedValue(undefined),
    sendQuestionResponseCommand: vi.fn().mockResolvedValue(undefined),
    hasActiveAgentSocket: vi.fn().mockReturnValue(false),
  };

  const moduleRef = {
    get: vi.fn().mockReturnValue(telemetryGateway),
  };

  const subagentOrchestrator = {
    cancelActiveForParent: vi
      .fn()
      .mockResolvedValue({ cancelled_execution_ids: [] }),
  };

  const sessionHydration = {
    findSessionTreeByWorkflowRunId: vi.fn().mockResolvedValue(null),
    findSessionTree: vi.fn().mockResolvedValue(null),
  };

  const eventEmitter = {
    emit: vi.fn(),
  };

  const workflowEventLog = {
    appendBestEffort: vi.fn().mockResolvedValue(undefined),
  };

  const questionAwaitRepo = {
    findOpenByRunId: vi.fn().mockResolvedValue(null),
    markAnswered: vi.fn().mockResolvedValue(undefined),
    markFailedDelivery: vi.fn().mockResolvedValue(undefined),
    cancelOpenForRun: vi.fn().mockResolvedValue(undefined),
  };

  const questionIdleTracker = {
    clearTracking: vi.fn(),
  };

  function createService() {
    return new WorkflowRunSteeringService(
      workflowEngine as never,
      workflowPersistence as never,
      streamService as never,
      pubsubService as never,
      sessionHydration as never,
      subagentOrchestrator as never,
      docker as never,
      eventEmitter,
      workflowEventLog as never,
      moduleRef,
      questionAwaitRepo as never,
      questionIdleTracker as never,
    );
  }

  it('pauses running container for workflow run', async () => {
    docker.listContainers.mockResolvedValueOnce([
      { Id: 'container-1', State: 'running', Created: 10 },
    ]);

    const service = createService();
    const result = await service.pause('run-1');

    expect(containerApi.pause).toHaveBeenCalled();
    expect(result.containerId).toBe('container-1');
    expect(streamService.persistEvent).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ event_type: 'workflow_control' }),
    );
  });

  it('resumes paused container for workflow run', async () => {
    docker.listContainers.mockResolvedValueOnce([
      { Id: 'container-2', State: 'paused', Created: 10 },
    ]);

    const service = createService();
    const result = await service.resume('run-1');

    expect(containerApi.unpause).toHaveBeenCalled();
    expect(result.containerId).toBe('container-2');
  });

  it('aborts container for workflow run', async () => {
    docker.listContainers.mockResolvedValueOnce([
      { Id: 'container-3', State: 'running', Created: 10 },
    ]);
    subagentOrchestrator.cancelActiveForParent.mockResolvedValueOnce({
      cancelled_execution_ids: ['exec-1'],
    });

    const service = createService();
    const result = await service.abort('run-1');

    expect(containerApi.kill).toHaveBeenCalled();
    expect(subagentOrchestrator.cancelActiveForParent).toHaveBeenCalledWith(
      'container-3',
      {
        workflowRunId: 'run-1',
        reason: 'user_abort',
      },
    );
    expect(workflowEventLog.appendBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        eventType: 'subagent.cancelled_by_parent_abort',
      }),
    );
    expect(workflowEngine.cancelWorkflowRun).toHaveBeenCalledWith(
      'run-1',
      'user_abort',
    );
    expect(result.containerId).toBe('container-3');
  });

  it('aborts the parent workflow container before newer child subagent containers', async () => {
    docker.listContainers.mockResolvedValueOnce([
      {
        Id: 'parent-container',
        State: 'running',
        Created: 10,
        Labels: {
          'nexus.workflow_run_id': 'run-1',
          'nexus.job_id': 'implement_and_commit',
          'nexus.step_id': 'implement',
        },
      },
      {
        Id: 'child-subagent-container',
        State: 'running',
        Created: 50,
        Labels: {
          'nexus.workflow_run_id': 'run-1',
          'nexus.parent_container_id': 'parent-container',
          'nexus.job_id': 'subagent-execution-1',
          'nexus.step_id': 'subagent-execution-1',
        },
      },
    ]);

    const service = createService();
    const result = await service.abort('run-1');

    expect(docker.getContainer).toHaveBeenCalledWith('parent-container');
    expect(subagentOrchestrator.cancelActiveForParent).toHaveBeenCalledWith(
      'parent-container',
      {
        workflowRunId: 'run-1',
        reason: 'user_abort',
      },
    );
    expect(result.containerId).toBe('parent-container');
  });

  it('cancels workflow run even when no active container exists', async () => {
    docker.listContainers.mockResolvedValueOnce([]);
    containerApi.kill.mockClear();
    workflowEngine.cancelWorkflowRun.mockClear();

    const service = createService();
    const result = await service.abort('run-1');

    expect(containerApi.kill).not.toHaveBeenCalled();
    expect(workflowEngine.cancelWorkflowRun).toHaveBeenCalledWith(
      'run-1',
      'user_abort',
    );
    expect(result.containerId).toBeNull();
  });

  it('rejects user message delivery when no container or saved session exists', async () => {
    docker.listContainers.mockResolvedValueOnce([]);
    sessionHydration.findSessionTreeByWorkflowRunId.mockResolvedValueOnce(null);
    const service = createService();

    await expect(
      service.injectMessage('run-1', 'Please rerun unit tests'),
    ).rejects.toThrow(
      'Unable to deliver guidance for workflow run run-1: no active container or saved session is available.',
    );
    expect(streamService.persistEvent).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ event_type: 'user_message' }),
    );
    expect(streamService.persistEvent).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        event_type: 'user_message_delivery_failed',
        payload: expect.objectContaining({
          reason: 'no_active_container_or_saved_session',
          message: 'Please rerun unit tests',
        }),
      }),
    );
    expect(workflowEventLog.appendBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        eventType: 'user_message.delivery_failed',
      }),
    );
  });

  it('forwards prompt to running container when one exists', async () => {
    docker.listContainers.mockResolvedValueOnce([
      {
        Id: 'live-1',
        State: 'running',
        Created: 20,
        Labels: { 'nexus.step_id': 'step-a' },
      },
    ]);

    const service = createService();
    const result = await service.injectMessage('run-1', 'focus on tests');

    expect(result.acknowledged).toBe(true);
    expect(telemetryGateway.sendPromptCommand).toHaveBeenCalledWith(
      'run-1',
      'step-a',
      'focus on tests',
    );
  });

  it('resumes session from saved tree when no container is running', async () => {
    docker.listContainers.mockResolvedValueOnce([]);
    sessionHydration.findSessionTreeByWorkflowRunId.mockResolvedValueOnce({
      id: 'tree-42',
      workflow_run_id: 'run-1',
      last_leaf_node_id: 'node-99',
    });

    const service = createService();
    const result = await service.injectMessage('run-1', 'commit changes');

    expect(result.acknowledged).toBe(true);
    expect(workflowEngine.resumeJobWithMessage).toHaveBeenCalledWith(
      'run-1',
      'tree-42',
      'commit changes',
    );
  });

  describe('telemetryGateway resolution', () => {
    it('throws a descriptive error when the gateway token resolves to null', () => {
      const service = new WorkflowRunSteeringService(
        workflowEngine as never,
        workflowPersistence as never,
        streamService as never,
        pubsubService as never,
        sessionHydration as never,
        subagentOrchestrator as never,
        docker as never,
        eventEmitter,
        workflowEventLog as never,
        { get: vi.fn().mockReturnValue(null) },
        questionAwaitRepo as never,
        questionIdleTracker as never,
      );

      expect(() => service['telemetryGateway']).toThrow(
        /TELEMETRY_GATEWAY resolved to null/,
      );
    });

    it('returns the gateway when resolution succeeds', () => {
      const gateway = {
        sendQuestionResponseCommand: vi.fn(),
        hasActiveAgentSocket: vi.fn().mockReturnValue(false),
      };
      const service = new WorkflowRunSteeringService(
        workflowEngine as never,
        workflowPersistence as never,
        streamService as never,
        pubsubService as never,
        sessionHydration as never,
        subagentOrchestrator as never,
        docker as never,
        eventEmitter,
        workflowEventLog as never,
        { get: vi.fn().mockReturnValue(gateway) },
        questionAwaitRepo as never,
        questionIdleTracker as never,
      );

      expect(service['telemetryGateway']).toBe(gateway);
    });
  });

  describe('submitQuestionAnswers', () => {
    const mockAnswers = [
      { questionIndex: 0, selectedOption: 'Yes', freeTextAnswer: null },
      {
        questionIndex: 1,
        selectedOption: null,
        freeTextAnswer: 'Custom answer',
      },
    ];

    beforeEach(() => {
      vi.clearAllMocks();
      workflowPersistence.getWorkflowRun.mockResolvedValue({ id: 'run-1' });
      workflowEngine.resumeJobWithMessage.mockResolvedValue('job-1');
      streamService.persistEvent.mockResolvedValue(undefined);
      pubsubService.publishEvent.mockResolvedValue(undefined);
      questionAwaitRepo.findOpenByRunId.mockResolvedValue(null);
      questionAwaitRepo.markAnswered.mockResolvedValue(undefined);
      questionAwaitRepo.markFailedDelivery.mockResolvedValue(undefined);
      questionIdleTracker.clearTracking.mockReset();
      moduleRef.get.mockReturnValue(telemetryGateway);
      telemetryGateway.hasActiveAgentSocket.mockReturnValue(false);
      telemetryGateway.sendQuestionResponseCommand.mockResolvedValue(undefined);
    });

    it('persists answer event and sends command to running container (legacy path: no durable row)', async () => {
      docker.listContainers.mockResolvedValueOnce([
        {
          Id: 'live-q',
          State: 'running',
          Created: 30,
          Labels: { 'nexus.step_id': 'step-q' },
        },
      ]);
      // No durable row — legacy path
      questionAwaitRepo.findOpenByRunId.mockResolvedValueOnce(null);

      const service = createService();
      const result = await service.submitQuestionAnswers('run-1', mockAnswers);

      expect(result.acknowledged).toBe(true);
      expect(streamService.persistEvent).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ event_type: 'user_question_answers' }),
      );
      expect(telemetryGateway.sendQuestionResponseCommand).toHaveBeenCalledWith(
        'run-1',
        'step-q',
        mockAnswers,
      );
    });

    it('selects the newest container when multiple are running (legacy path)', async () => {
      docker.listContainers.mockResolvedValueOnce([
        {
          Id: 'old-container',
          State: 'running',
          Created: 10,
          Labels: { 'nexus.step_id': 'step-old' },
        },
        {
          Id: 'new-container',
          State: 'running',
          Created: 50,
          Labels: { 'nexus.step_id': 'step-new' },
        },
      ]);
      questionAwaitRepo.findOpenByRunId.mockResolvedValueOnce(null);

      const service = createService();
      await service.submitQuestionAnswers('run-1', mockAnswers);

      expect(telemetryGateway.sendQuestionResponseCommand).toHaveBeenCalledWith(
        'run-1',
        'step-new',
        mockAnswers,
      );
    });

    it('emits USER_QUESTIONS_ANSWERED_EVENT when answers are submitted (legacy path)', async () => {
      docker.listContainers.mockResolvedValueOnce([
        {
          Id: 'live-q',
          State: 'running',
          Created: 30,
          Labels: { 'nexus.step_id': 'step-q' },
        },
      ]);
      questionAwaitRepo.findOpenByRunId.mockResolvedValueOnce(null);

      const service = createService();
      await service.submitQuestionAnswers('run-1', mockAnswers);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'workflow.user_questions.answered',
        { workflowRunId: 'run-1' },
      );
    });

    it('throws ConflictException and does not emit the answered event when no container and no session tree (legacy path, no durable row)', async () => {
      docker.listContainers.mockResolvedValueOnce([]);
      sessionHydration.findSessionTreeByWorkflowRunId.mockResolvedValueOnce(
        null,
      );
      questionAwaitRepo.findOpenByRunId.mockResolvedValueOnce(null);

      const service = createService();
      await expect(
        service.submitQuestionAnswers('run-1', mockAnswers),
      ).rejects.toThrow(ConflictException);

      expect(
        telemetryGateway.sendQuestionResponseCommand,
      ).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'workflow.user_questions.answered',
        expect.anything(),
      );
    });

    it('acknowledges when container stopped but session tree exists (legacy path)', async () => {
      docker.listContainers.mockResolvedValueOnce([]);
      sessionHydration.findSessionTreeByWorkflowRunId.mockResolvedValueOnce({
        id: 'tree-99',
        workflow_run_id: 'run-1',
      });
      questionAwaitRepo.findOpenByRunId.mockResolvedValueOnce(null);

      const service = createService();
      const result = await service.submitQuestionAnswers('run-1', mockAnswers);

      expect(result.acknowledged).toBe(true);
      expect(streamService.persistEvent).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ event_type: 'user_question_answers' }),
      );
      expect(workflowEngine.resumeJobWithMessage).toHaveBeenCalledWith(
        'run-1',
        'tree-99',
        expect.stringContaining(
          'The user answered your previously asked questions.',
        ),
      );
      expect(workflowEngine.resumeJobWithMessage).toHaveBeenCalledWith(
        'run-1',
        'tree-99',
        expect.stringContaining('Q1: option=Yes'),
      );
      expect(workflowEngine.resumeJobWithMessage).toHaveBeenCalledWith(
        'run-1',
        'tree-99',
        expect.stringContaining('Q2: text=Custom answer'),
      );
    });

    it('logs structured event via WorkflowEventLogService when answers submitted (legacy path)', async () => {
      docker.listContainers.mockResolvedValueOnce([
        {
          Id: 'live-q',
          State: 'running',
          Created: 30,
          Labels: { 'nexus.step_id': 'step-q' },
        },
      ]);
      questionAwaitRepo.findOpenByRunId.mockResolvedValueOnce(null);

      const service = createService();
      await service.submitQuestionAnswers('run-1', mockAnswers);

      expect(workflowEventLog.appendBestEffort).toHaveBeenCalledWith({
        workflowRunId: 'run-1',
        eventType: 'user_questions.answered',
        payload: { answerCount: 2 },
      });
    });

    it('logs warning when WS delivery fails but container is running (legacy path)', async () => {
      docker.listContainers.mockResolvedValueOnce([
        {
          Id: 'live-q',
          State: 'running',
          Created: 30,
          Labels: { 'nexus.step_id': 'step-q' },
        },
      ]);
      telemetryGateway.sendQuestionResponseCommand.mockRejectedValueOnce(
        new Error('Socket not found'),
      );
      questionAwaitRepo.findOpenByRunId.mockResolvedValueOnce(null);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const service = createService();

      // WS delivery failed and there is no saved session tree, so the legacy
      // path must throw rather than falsely acknowledge.
      await expect(
        service.submitQuestionAnswers('run-1', mockAnswers),
      ).rejects.toThrow(ConflictException);

      // The fallback path is entered (session lookup happens) before throwing.
      expect(
        sessionHydration.findSessionTreeByWorkflowRunId,
      ).toHaveBeenCalledWith('run-1');
      warnSpy.mockRestore();
    });
  });

  describe('submitQuestionAnswers (durable flow)', () => {
    const ANSWERS = [
      { questionIndex: 0, selectedOption: null, freeTextAnswer: 'Ship it' },
    ];
    const OPEN_ROW = {
      id: 'q-1',
      workflow_run_id: 'run-1',
      job_id: 'refine_charter',
      step_id: 'refine',
      status: 'pending',
    };

    beforeEach(() => {
      vi.clearAllMocks();
      workflowPersistence.getWorkflowRun.mockResolvedValue({ id: 'run-1' });
      workflowEngine.resumeJobWithMessage.mockResolvedValue('job-1');
      streamService.persistEvent.mockResolvedValue(undefined);
      pubsubService.publishEvent.mockResolvedValue(undefined);
      questionAwaitRepo.findOpenByRunId.mockResolvedValue(OPEN_ROW);
      questionAwaitRepo.markAnswered.mockResolvedValue(undefined);
      questionAwaitRepo.markFailedDelivery.mockResolvedValue(undefined);
      questionIdleTracker.clearTracking.mockReset();
      moduleRef.get.mockReturnValue(telemetryGateway);
      telemetryGateway.hasActiveAgentSocket.mockReturnValue(false);
      telemetryGateway.sendQuestionResponseCommand.mockResolvedValue(undefined);
    });

    it('delivers over WS to the recorded step and marks the row answered', async () => {
      telemetryGateway.hasActiveAgentSocket.mockReturnValue(true);

      const service = createService();
      await service.submitQuestionAnswers('run-1', ANSWERS);

      expect(telemetryGateway.sendQuestionResponseCommand).toHaveBeenCalledWith(
        'run-1',
        'refine',
        ANSWERS,
      );
      expect(questionAwaitRepo.markAnswered).toHaveBeenCalledWith(
        'q-1',
        ANSWERS,
        'ws',
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'workflow.user_questions.answered',
        { workflowRunId: 'run-1' },
      );
    });

    it('resumes the recorded job when no agent socket exists', async () => {
      telemetryGateway.hasActiveAgentSocket.mockReturnValue(false);
      sessionHydration.findSessionTreeByWorkflowRunId.mockResolvedValueOnce({
        id: 'tree-1',
      });

      const service = createService();
      await service.submitQuestionAnswers('run-1', ANSWERS);

      expect(workflowEngine.resumeJobWithMessage).toHaveBeenCalledWith(
        'run-1',
        'tree-1',
        expect.stringContaining('Ship it'),
        { jobId: 'refine_charter' },
      );
      expect(questionAwaitRepo.markAnswered).toHaveBeenCalledWith(
        'q-1',
        ANSWERS,
        'resume',
      );
    });

    it('falls through to resume when WS delivery throws despite an active socket', async () => {
      telemetryGateway.hasActiveAgentSocket.mockReturnValue(true);
      telemetryGateway.sendQuestionResponseCommand.mockRejectedValueOnce(
        new Error('socket write failed'),
      );
      sessionHydration.findSessionTreeByWorkflowRunId.mockResolvedValueOnce({
        id: 'tree-1',
      });

      const service = createService();
      await service.submitQuestionAnswers('run-1', ANSWERS);

      expect(workflowEngine.resumeJobWithMessage).toHaveBeenCalledWith(
        'run-1',
        'tree-1',
        expect.stringContaining('Ship it'),
        { jobId: 'refine_charter' },
      );
      expect(questionAwaitRepo.markAnswered).toHaveBeenCalledWith(
        'q-1',
        ANSWERS,
        'resume',
      );
      expect(questionAwaitRepo.markAnswered).not.toHaveBeenCalledWith(
        'q-1',
        ANSWERS,
        'ws',
      );
    });

    it('throws ConflictException and marks failed_delivery when no socket and no session tree', async () => {
      telemetryGateway.hasActiveAgentSocket.mockReturnValue(false);
      sessionHydration.findSessionTreeByWorkflowRunId.mockResolvedValueOnce(
        null,
      );

      const service = createService();
      await expect(
        service.submitQuestionAnswers('run-1', ANSWERS),
      ).rejects.toThrow(ConflictException);

      expect(questionAwaitRepo.markFailedDelivery).toHaveBeenCalledWith(
        'q-1',
        ANSWERS,
      );
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'workflow.user_questions.answered',
        expect.anything(),
      );
    });
  });

  describe('abort cancels open questions', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      workflowPersistence.getWorkflowRun.mockResolvedValue({ id: 'run-1' });
      workflowEngine.cancelWorkflowRun.mockResolvedValue(undefined);
      streamService.persistEvent.mockResolvedValue(undefined);
      pubsubService.publishEvent.mockResolvedValue(undefined);
      questionAwaitRepo.cancelOpenForRun.mockResolvedValue(undefined);
      questionIdleTracker.clearTracking.mockReset();
    });

    it('cancels open user_question_awaits rows when aborting', async () => {
      docker.listContainers.mockResolvedValueOnce([]);

      const service = createService();
      await service.abort('run-1');

      expect(questionAwaitRepo.cancelOpenForRun).toHaveBeenCalledWith('run-1');
      expect(questionIdleTracker.clearTracking).toHaveBeenCalledWith('run-1');
    });
  });
});
