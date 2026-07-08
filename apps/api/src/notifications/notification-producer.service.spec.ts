import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProducerService } from './notification-producer.service';

describe('NotificationProducerService', () => {
  const notificationRepo = {
    create: vi.fn(),
    markUnreadInAppByCorrelationIdAsRead: vi.fn(),
    findUnreadInAppByUserAndCorrelationId: vi.fn(),
  };
  const workflowPersistence = {
    getWorkflowRun: vi.fn(),
  };
  const notificationGateway = {
    broadcastNewNotification: vi.fn(),
  };
  const userRepo = {
    findActiveAdmins: vi.fn(),
  };

  let service: NotificationProducerService;

  beforeEach(() => {
    vi.resetAllMocks();
    notificationRepo.create.mockImplementation(async (notification) => ({
      id: `notification:${notification.userId}`,
      ...notification,
    }));
    notificationRepo.findUnreadInAppByUserAndCorrelationId.mockResolvedValue(
      null,
    );
    service = new NotificationProducerService(
      notificationRepo as never,
      workflowPersistence as never,
      notificationGateway as never,
      userRepo as never,
    );
  });

  it('notifies active admins when a tool call requires approval', async () => {
    userRepo.findActiveAdmins.mockResolvedValue([
      { id: 'admin-1' },
      { id: 'admin-2' },
    ]);

    await service.handleToolCallApprovalRequired({
      scopeId: 'proj-1',
      requestId: 'approval-1',
      toolName: 'bash',
    });

    expect(notificationRepo.create).toHaveBeenCalledTimes(2);
    expect(notificationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        scopeId: 'proj-1',
        subject: 'Tool Approval Needed: bash',
        eventType: 'tool_call.approval_needed',
        correlationId: 'tool_call.approval_needed:approval-1',
        metadata: {
          scopeId: 'proj-1',
          requestId: 'approval-1',
          toolName: 'bash',
        },
      }),
    );
    expect(notificationGateway.broadcastNewNotification).toHaveBeenCalledTimes(
      2,
    );
    expect(notificationGateway.broadcastNewNotification).toHaveBeenCalledWith(
      'admin-1',
      expect.objectContaining({ id: 'notification:admin-1' }),
    );
  });

  it('notifies active admins for approval requests without project context', async () => {
    userRepo.findActiveAdmins.mockResolvedValue([{ id: 'admin-1' }]);

    await service.handleToolCallApprovalRequired({
      requestId: 'approval-2',
      toolName: 'read',
    });

    expect(notificationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        scopeId: null,
        subject: 'Tool Approval Needed: read',
        metadata: {
          scopeId: null,
          requestId: 'approval-2',
          toolName: 'read',
        },
      }),
    );
  });

  describe('notifyWorkflowRunFailed', () => {
    it('creates an in-app notification for each active admin', async () => {
      userRepo.findActiveAdmins.mockResolvedValue([
        { id: 'admin-1' },
        { id: 'admin-2' },
      ]);

      await service.notifyWorkflowRunFailed('scope-xyz', 'run-abc');

      expect(userRepo.findActiveAdmins).toHaveBeenCalledOnce();
      expect(notificationRepo.create).toHaveBeenCalledTimes(2);
      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          channel: 'in_app',
          eventType: 'workflow.run.failed',
          scopeId: 'scope-xyz',
        }),
      );
      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-2',
          channel: 'in_app',
          eventType: 'workflow.run.failed',
          scopeId: 'scope-xyz',
        }),
      );
    });

    it('broadcasts to the gateway for each notification created', async () => {
      userRepo.findActiveAdmins.mockResolvedValue([{ id: 'admin-1' }]);
      const notif = { id: 'notification:admin-1', userId: 'admin-1' };
      notificationRepo.create.mockResolvedValue(notif);

      await service.notifyWorkflowRunFailed('scope-xyz', 'run-abc');

      expect(notificationGateway.broadcastNewNotification).toHaveBeenCalledWith(
        'admin-1',
        notif,
      );
    });

    it('does nothing when there are no active admins', async () => {
      userRepo.findActiveAdmins.mockResolvedValue([]);

      await service.notifyWorkflowRunFailed('scope-xyz', 'run-abc');

      expect(notificationRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('notifyOrchestrationActionPending', () => {
    it('creates an in-app notification for each active admin', async () => {
      userRepo.findActiveAdmins.mockResolvedValue([
        { id: 'admin-1' },
        { id: 'admin-2' },
      ]);

      await service.notifyOrchestrationActionPending(
        'scope-xyz',
        'action-req-1',
        'approve',
      );

      expect(userRepo.findActiveAdmins).toHaveBeenCalledOnce();
      expect(notificationRepo.create).toHaveBeenCalledTimes(2);
      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          channel: 'in_app',
          eventType: 'orchestration_action.pending',
          scopeId: 'scope-xyz',
        }),
      );
    });

    it('broadcasts to the gateway for each notification', async () => {
      userRepo.findActiveAdmins.mockResolvedValue([{ id: 'admin-1' }]);
      const notif = { id: 'notification:admin-1', userId: 'admin-1' };
      notificationRepo.create.mockResolvedValue(notif);

      await service.notifyOrchestrationActionPending(
        'scope-xyz',
        'req-1',
        'review',
      );

      expect(notificationGateway.broadcastNewNotification).toHaveBeenCalledWith(
        'admin-1',
        notif,
      );
    });
  });

  describe('handleUserQuestionsPosed', () => {
    it('creates an in-app notification for each active admin when questions are posed', async () => {
      workflowPersistence.getWorkflowRun.mockResolvedValue({
        state_variables: {
          trigger: { scopeId: 'scope-xyz', contextId: 'ctx-1' },
        },
      });
      userRepo.findActiveAdmins.mockResolvedValue([
        { id: 'admin-1' },
        { id: 'admin-2' },
      ]);
      await service.handleUserQuestionsPosed({
        workflowRunId: 'run-abc',
        questions: [{ question: 'What should I do?' }],
      });

      expect(userRepo.findActiveAdmins).toHaveBeenCalledOnce();
      expect(notificationRepo.create).toHaveBeenCalledTimes(2);
      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          channel: 'in_app',
          eventType: 'workflow.user_input.required',
          correlationId: 'user_questions.posed:run-abc',
        }),
      );
    });

    it('uses the first question as the notification body', async () => {
      workflowPersistence.getWorkflowRun.mockResolvedValue({
        state_variables: { trigger: { scopeId: 'scope-xyz', contextId: null } },
      });
      userRepo.findActiveAdmins.mockResolvedValue([{ id: 'admin-1' }]);

      await service.handleUserQuestionsPosed({
        workflowRunId: 'run-abc',
        questions: [{ question: 'Shall we proceed?' }],
      });

      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'Shall we proceed?' }),
      );
    });

    it('uses a fallback body when questions array is empty', async () => {
      workflowPersistence.getWorkflowRun.mockResolvedValue({
        state_variables: { trigger: { scopeId: 'scope-xyz', contextId: null } },
      });
      userRepo.findActiveAdmins.mockResolvedValue([{ id: 'admin-1' }]);

      await service.handleUserQuestionsPosed({
        workflowRunId: 'run-abc',
        questions: [],
      });

      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'The orchestrator has a question for you.',
        }),
      );
    });

    it('skips duplicate notifications via correlation id dedup', async () => {
      workflowPersistence.getWorkflowRun.mockResolvedValue({
        state_variables: { trigger: { scopeId: 'scope-xyz', contextId: null } },
      });
      userRepo.findActiveAdmins.mockResolvedValue([
        { id: 'admin-1' },
        { id: 'admin-2' },
      ]);
      notificationRepo.findUnreadInAppByUserAndCorrelationId
        .mockResolvedValueOnce({ id: 'existing' }) // admin-1 already notified
        .mockResolvedValueOnce(null); // admin-2 not yet

      await service.handleUserQuestionsPosed({
        workflowRunId: 'run-abc',
        questions: [{ question: 'Proceed?' }],
      });

      expect(notificationRepo.create).toHaveBeenCalledTimes(1);
      expect(notificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin-2' }),
      );
    });

    it('does nothing when the workflow run has no scopeId', async () => {
      workflowPersistence.getWorkflowRun.mockResolvedValue({
        state_variables: { trigger: {} },
      });
      userRepo.findActiveAdmins.mockResolvedValue([{ id: 'admin-1' }]);

      await service.handleUserQuestionsPosed({
        workflowRunId: 'run-abc',
        questions: [{ question: 'Proceed?' }],
      });

      expect(notificationRepo.create).not.toHaveBeenCalled();
    });
  });
});
