import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ChatSessionStatus } from '@nexus/core';
import { WorkflowRunChatSessionCascadeListener } from './workflow-run-chat-session-cascade.listener';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';

describe('WorkflowRunChatSessionCascadeListener', () => {
  let listener: WorkflowRunChatSessionCascadeListener;
  let chatSessionRepo: ReturnType<typeof createMockChatSessionRepository>;

  beforeEach(async () => {
    vi.clearAllMocks();

    chatSessionRepo = createMockChatSessionRepository();

    const module = await Test.createTestingModule({
      providers: [
        WorkflowRunChatSessionCascadeListener,
        { provide: ChatSessionRepository, useValue: chatSessionRepo },
      ],
    }).compile();

    listener = module.get(WorkflowRunChatSessionCascadeListener);
  });

  const createEvent = (
    overrides?: Partial<WorkflowRunEvent>,
  ): WorkflowRunEvent => ({
    workflowRunId: 'run-1',
    workflowId: 'wf-1',
    status: 'RUNNING',
    stateVariables: {},
    ...overrides,
  });

  it('updates linked chat sessions to COMPLETED when workflow run completes', async () => {
    // Arrange
    chatSessionRepo.findByWorkflowRunId.mockResolvedValue([
      { id: 'session-1', status: ChatSessionStatus.RUNNING },
      { id: 'session-2', status: ChatSessionStatus.STARTING },
    ]);
    chatSessionRepo.update.mockResolvedValue({
      id: 'session-1',
      status: ChatSessionStatus.COMPLETED,
    });

    // Act
    await listener.onRunCompleted(createEvent());

    // Assert
    expect(chatSessionRepo.findByWorkflowRunId).toHaveBeenCalledWith('run-1');
    expect(chatSessionRepo.update).toHaveBeenCalledTimes(2);
    expect(chatSessionRepo.update).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        status: ChatSessionStatus.COMPLETED,
        execution_state: 'completed',
        completed_at: expect.any(Date),
      }),
    );
    expect(chatSessionRepo.update).toHaveBeenCalledWith(
      'session-2',
      expect.objectContaining({
        status: ChatSessionStatus.COMPLETED,
        execution_state: 'completed',
        completed_at: expect.any(Date),
      }),
    );
  });

  it('routes FAILED through the idempotent writer when workflow run fails', async () => {
    // Arrange
    chatSessionRepo.findByWorkflowRunId.mockResolvedValue([
      { id: 'session-1', status: ChatSessionStatus.RUNNING },
    ]);
    chatSessionRepo.failIfNotTerminal.mockResolvedValue(true);

    // Act
    await listener.onRunFailed(createEvent({ reason: 'Step timed out' }));

    // Assert — the generic run cascade must not clobber a specific reason, so it
    // goes through failIfNotTerminal rather than a direct update.
    expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledWith(
      'session-1',
      {
        message: 'Step timed out',
      },
    );
    expect(chatSessionRepo.update).not.toHaveBeenCalled();
  });

  it('updates linked chat sessions to CANCELLED when workflow run is cancelled', async () => {
    // Arrange
    chatSessionRepo.findByWorkflowRunId.mockResolvedValue([
      { id: 'session-1', status: ChatSessionStatus.RUNNING },
    ]);
    chatSessionRepo.update.mockResolvedValue({
      id: 'session-1',
      status: ChatSessionStatus.CANCELLED,
    });

    // Act
    await listener.onRunCancelled(createEvent());

    // Assert
    expect(chatSessionRepo.update).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        status: ChatSessionStatus.CANCELLED,
        execution_state: 'cancelled',
        completed_at: expect.any(Date),
      }),
    );
  });

  it('skips sessions that are already in a terminal state', async () => {
    // Arrange
    chatSessionRepo.findByWorkflowRunId.mockResolvedValue([
      { id: 'session-1', status: ChatSessionStatus.COMPLETED },
      { id: 'session-2', status: ChatSessionStatus.FAILED },
      { id: 'session-3', status: ChatSessionStatus.CANCELLED },
      { id: 'session-4', status: ChatSessionStatus.RUNNING },
    ]);
    chatSessionRepo.update.mockResolvedValue({
      id: 'session-4',
      status: ChatSessionStatus.COMPLETED,
    });

    // Act
    await listener.onRunCompleted(createEvent());

    // Assert
    expect(chatSessionRepo.update).toHaveBeenCalledTimes(1);
    expect(chatSessionRepo.update).toHaveBeenCalledWith(
      'session-4',
      expect.any(Object),
    );
  });

  it('does nothing when no linked sessions exist', async () => {
    // Arrange
    chatSessionRepo.findByWorkflowRunId.mockResolvedValue([]);

    // Act
    await listener.onRunCompleted(createEvent());

    // Assert
    expect(chatSessionRepo.update).not.toHaveBeenCalled();
  });

  it('handles repository errors gracefully', async () => {
    // Arrange
    chatSessionRepo.findByWorkflowRunId.mockRejectedValue(
      new Error('Database error'),
    );

    // Act & Assert
    await expect(listener.onRunCompleted(createEvent())).resolves.not.toThrow();
    expect(chatSessionRepo.update).not.toHaveBeenCalled();
  });
});

// Mock factory function
function createMockChatSessionRepository() {
  return {
    findById: vi.fn(),
    findByIds: vi.fn(),
    findAll: vi.fn(),
    count: vi.fn(),
    findOrphanedSessions: vi.fn(),
    findByWorkflowRunId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    failIfNotTerminal: vi.fn(),
  };
}
