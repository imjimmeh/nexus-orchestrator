import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { vi, describe, it, beforeEach, afterEach, expect } from 'vitest';
import { ChatSessionConsumer } from './chat-session.consumer';
import { ChatExecutionService } from './chat-execution.service';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';
import { ChatSessionJobData, ChatSessionStatus } from '@nexus/core';
import { Job } from 'bullmq';

describe('ChatSessionConsumer', () => {
  let consumer: ChatSessionConsumer;
  let chatExecutionService: {
    executeChatSession: ReturnType<typeof vi.fn>;
  };
  let chatSessionRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  const mockJobData: ChatSessionJobData = {
    chatSessionId: 'session-123',
    agentProfileName: 'test-agent',
    agentProfileId: 'agent-456',
    contextId: 'project-789',
    contextType: 'project',
    initialMessage: 'Hello, world!',
    containerTier: 1,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    chatExecutionService = {
      executeChatSession: vi.fn().mockResolvedValue(undefined),
    };

    chatSessionRepo = {
      findById: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatSessionConsumer,
        { provide: ChatExecutionService, useValue: chatExecutionService },
        { provide: ChatSessionRepository, useValue: chatSessionRepo },
        { provide: EventEmitter2, useValue: { emit: vi.fn() } },
      ],
    }).compile();

    consumer = module.get(ChatSessionConsumer);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createRetryJob(id: string): Job<ChatSessionJobData> {
    return {
      id,
      name: 'execute-chat-session',
      data: mockJobData,
    };
  }

  function createSession(overrides: Record<string, unknown>) {
    return {
      id: mockJobData.chatSessionId,
      status: ChatSessionStatus.RUNNING,
      execution_state: 'retry_scheduled',
      retry_metadata: null,
      ...overrides,
    };
  }

  describe('process', () => {
    it('should process chat session job successfully', async () => {
      const job = {
        id: 'job-1',
        data: mockJobData,
      } as unknown as Job<ChatSessionJobData>;

      await consumer.process(job);

      expect(chatExecutionService.executeChatSession).toHaveBeenCalledWith(
        mockJobData,
      );
      expect(chatExecutionService.executeChatSession).toHaveBeenCalledTimes(1);
    });

    it('should re-throw error when execution fails', async () => {
      const error = new Error('Execution failed');
      chatExecutionService.executeChatSession.mockRejectedValue(error);

      const job = {
        id: 'job-1',
        data: mockJobData,
      } as unknown as Job<ChatSessionJobData>;

      await expect(consumer.process(job)).rejects.toThrow('Execution failed');
      expect(chatExecutionService.executeChatSession).toHaveBeenCalledWith(
        mockJobData,
      );
    });

    it('skips stale retry job when session is FAILED', async () => {
      chatSessionRepo.findById.mockResolvedValue(
        createSession({
          status: ChatSessionStatus.FAILED,
          execution_state: 'retry_scheduled',
          retry_metadata: {
            attempt: 1,
            retryJobId: 'chat-session-retry:session-123:1',
          },
        }),
      );
      const job = createRetryJob('chat-session-retry:session-123:1');

      await consumer.process(job);

      expect(chatExecutionService.executeChatSession).not.toHaveBeenCalled();
    });

    it('skips stale retry job when execution state is not retry_scheduled', async () => {
      chatSessionRepo.findById.mockResolvedValue(
        createSession({
          status: ChatSessionStatus.RUNNING,
          execution_state: 'failed',
          retry_metadata: {
            attempt: 1,
            retryJobId: 'chat-session-retry:session-123:1',
          },
        }),
      );
      const job = createRetryJob('chat-session-retry:session-123:1');

      await consumer.process(job);

      expect(chatExecutionService.executeChatSession).not.toHaveBeenCalled();
    });

    it('skips stale retry job when status is not RUNNING', async () => {
      chatSessionRepo.findById.mockResolvedValue(
        createSession({
          status: ChatSessionStatus.STARTING,
          execution_state: 'retry_scheduled',
          retry_metadata: {
            attempt: 1,
            retryJobId: 'chat-session-retry:session-123:1',
          },
        }),
      );
      const job = createRetryJob('chat-session-retry:session-123:1');

      await consumer.process(job);

      expect(chatExecutionService.executeChatSession).not.toHaveBeenCalled();
    });

    it('skips stale retry job when retry metadata job id does not match', async () => {
      chatSessionRepo.findById.mockResolvedValue(
        createSession({
          status: ChatSessionStatus.RUNNING,
          execution_state: 'retry_scheduled',
          retry_metadata: {
            attempt: 1,
            retryJobId: 'chat-session-retry:session-123:1',
          },
        }),
      );
      const job = createRetryJob('chat-session-retry:session-123:2');

      await consumer.process(job);

      expect(chatExecutionService.executeChatSession).not.toHaveBeenCalled();
    });

    it('skips stale retry job when retry metadata attempt does not match', async () => {
      chatSessionRepo.findById.mockResolvedValue(
        createSession({
          status: ChatSessionStatus.RUNNING,
          execution_state: 'retry_scheduled',
          retry_metadata: {
            attempt: 1,
            retryJobId: 'chat-session-retry:session-123:2',
          },
        }),
      );
      const job = createRetryJob('chat-session-retry:session-123:2');

      await consumer.process(job);

      expect(chatExecutionService.executeChatSession).not.toHaveBeenCalled();
    });

    it('proceeds when retry job matches retry metadata', async () => {
      chatSessionRepo.findById.mockResolvedValue(
        createSession({
          status: ChatSessionStatus.RUNNING,
          execution_state: 'retry_scheduled',
          retry_metadata: {
            attempt: 1,
            retryJobId: 'chat-session-retry:session-123:1',
          },
        }),
      );
      const job = createRetryJob('chat-session-retry:session-123:1');

      await consumer.process(job);

      expect(chatExecutionService.executeChatSession).toHaveBeenCalledWith(
        mockJobData,
      );
    });
  });

  describe('onFailed', () => {
    it('should do nothing when job is undefined', async () => {
      await consumer.onFailed(undefined, new Error('test'));

      expect(chatSessionRepo.update).not.toHaveBeenCalled();
    });

    it('should skip final failure handling when retries remain', async () => {
      const job = {
        id: 'job-1',
        data: mockJobData,
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as unknown as Job<ChatSessionJobData>;

      await consumer.onFailed(job, new Error('Transient error'));

      expect(chatSessionRepo.update).not.toHaveBeenCalled();
    });

    it('should update session status to FAILED on final failure', async () => {
      const error = new Error('Permanent failure');
      const job = {
        id: 'job-1',
        data: mockJobData,
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as unknown as Job<ChatSessionJobData>;

      await consumer.onFailed(job, error);

      expect(chatSessionRepo.update).toHaveBeenCalledWith(
        mockJobData.chatSessionId,
        {
          status: ChatSessionStatus.FAILED,
          execution_state: 'failed',
          error_message: 'Permanent failure',

          completed_at: expect.any(Date),
        },
      );
    });

    it('should update session status when attempts equals max attempts', async () => {
      const error = new Error('Failed');
      const job = {
        id: 'job-1',
        data: mockJobData,
        attemptsMade: 1,
        opts: { attempts: 1 },
      } as unknown as Job<ChatSessionJobData>;

      await consumer.onFailed(job, error);

      expect(chatSessionRepo.update).toHaveBeenCalledWith(
        mockJobData.chatSessionId,
        {
          status: ChatSessionStatus.FAILED,
          execution_state: 'failed',
          error_message: 'Failed',

          completed_at: expect.any(Date),
        },
      );
    });

    it('should handle job with no attempts option (defaults to 1)', async () => {
      const error = new Error('Failed');
      const job = {
        id: 'job-1',
        data: mockJobData,
        attemptsMade: 1,
        opts: {},
      } as unknown as Job<ChatSessionJobData>;

      await consumer.onFailed(job, error);

      expect(chatSessionRepo.update).toHaveBeenCalledWith(
        mockJobData.chatSessionId,
        {
          status: ChatSessionStatus.FAILED,
          execution_state: 'failed',
          error_message: 'Failed',

          completed_at: expect.any(Date),
        },
      );
    });

    it('should handle job with attemptsMade less than max attempts (retry scenario)', async () => {
      const error = new Error('Transient');
      const job = {
        id: 'job-1',
        data: mockJobData,
        attemptsMade: 2,
        opts: { attempts: 5 },
      } as unknown as Job<ChatSessionJobData>;

      await consumer.onFailed(job, error);

      expect(chatSessionRepo.update).not.toHaveBeenCalled();
    });
  });
});
