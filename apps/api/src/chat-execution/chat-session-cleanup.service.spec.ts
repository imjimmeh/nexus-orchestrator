import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  ChatSessionCleanupService,
  STARTING_STALE_GRACE_MS,
  STUCK_STARTING_REASON,
  ORPHANED_SESSION_REASON,
} from './chat-session-cleanup.service';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';

describe('ChatSessionCleanupService', () => {
  let service: ChatSessionCleanupService;
  let chatSessionRepo: ReturnType<typeof createMockChatSessionRepository>;

  beforeEach(async () => {
    vi.clearAllMocks();

    chatSessionRepo = createMockChatSessionRepository();
    chatSessionRepo.findOrphanedSessions.mockResolvedValue([]);
    chatSessionRepo.findStaleStartingSessions.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      providers: [
        ChatSessionCleanupService,
        { provide: ChatSessionRepository, useValue: chatSessionRepo },
      ],
    }).compile();

    service = module.get(ChatSessionCleanupService);
  });

  describe('cleanupOrphanedSessions', () => {
    it('returns 0 when no orphaned sessions exist', async () => {
      // Arrange
      chatSessionRepo.findOrphanedSessions.mockResolvedValue([]);

      // Act
      const result = await service.cleanupOrphanedSessions();

      // Assert
      expect(result).toBe(0);
      expect(chatSessionRepo.findOrphanedSessions).toHaveBeenCalled();
      expect(chatSessionRepo.failIfNotTerminal).not.toHaveBeenCalled();
    });

    it('delegates idempotency to the repository — calls failIfNotTerminal for all sessions, counts only those where it returned true', async () => {
      // Arrange: two sessions; the repo signals the first is already terminal
      const orphanedSessions = [
        { id: 'session-already-terminal' },
        { id: 'session-not-terminal' },
      ];
      chatSessionRepo.findOrphanedSessions.mockResolvedValue(orphanedSessions);
      chatSessionRepo.failIfNotTerminal
        .mockResolvedValueOnce(false) // already terminal — repo no-ops
        .mockResolvedValueOnce(true); // successfully written

      // Act
      const result = await service.cleanupOrphanedSessions();

      // Assert: service passes ALL sessions to the repo (no pre-filter).
      expect(result).toBe(1);
      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledTimes(2);
      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledWith(
        'session-already-terminal',
        { message: ORPHANED_SESSION_REASON },
      );
      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledWith(
        'session-not-terminal',
        { message: ORPHANED_SESSION_REASON },
      );
    });

    it('calls failIfNotTerminal for each orphaned session with the orphaned reason', async () => {
      // Arrange
      const orphanedSessions = [
        { id: 'session-1' },
        { id: 'session-2' },
        { id: 'session-3' },
      ];
      chatSessionRepo.findOrphanedSessions.mockResolvedValue(orphanedSessions);
      chatSessionRepo.failIfNotTerminal.mockResolvedValue(true);

      // Act
      const result = await service.cleanupOrphanedSessions();

      // Assert
      expect(result).toBe(3);
      expect(chatSessionRepo.findOrphanedSessions).toHaveBeenCalledTimes(1);
      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledTimes(3);
      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledWith(
        'session-1',
        { message: ORPHANED_SESSION_REASON },
      );
      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledWith(
        'session-2',
        { message: ORPHANED_SESSION_REASON },
      );
      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledWith(
        'session-3',
        { message: ORPHANED_SESSION_REASON },
      );
    });

    it('handles errors gracefully when failIfNotTerminal throws', async () => {
      // Arrange
      const orphanedSessions = [
        { id: 'session-1' },
        { id: 'session-2' },
        { id: 'session-3' },
      ];
      chatSessionRepo.findOrphanedSessions.mockResolvedValue(orphanedSessions);
      chatSessionRepo.failIfNotTerminal
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce(true);

      // Act
      const result = await service.cleanupOrphanedSessions();

      // Assert
      expect(result).toBe(2);
      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledTimes(3);
    });

    it('handles when all failIfNotTerminal calls throw', async () => {
      // Arrange
      const orphanedSessions = [{ id: 'session-1' }, { id: 'session-2' }];
      chatSessionRepo.findOrphanedSessions.mockResolvedValue(orphanedSessions);
      chatSessionRepo.failIfNotTerminal.mockRejectedValue(
        new Error('Database connection lost'),
      );

      // Act
      const result = await service.cleanupOrphanedSessions();

      // Assert
      expect(result).toBe(0);
      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledTimes(2);
    });

    it('processes single orphaned session correctly', async () => {
      // Arrange
      const orphanedSessions = [{ id: 'single-session' }];
      chatSessionRepo.findOrphanedSessions.mockResolvedValue(orphanedSessions);
      chatSessionRepo.failIfNotTerminal.mockResolvedValue(true);

      // Act
      const result = await service.cleanupOrphanedSessions();

      // Assert
      expect(result).toBe(1);
      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledWith(
        'single-session',
        { message: ORPHANED_SESSION_REASON },
      );
    });
  });

  describe('cleanupStuckStartingSessions', () => {
    it('returns 0 when no stuck STARTING sessions exist', async () => {
      // Arrange
      chatSessionRepo.findStaleStartingSessions.mockResolvedValue([]);

      // Act
      const result = await service.cleanupStuckStartingSessions();

      // Assert
      expect(result).toBe(0);
      expect(chatSessionRepo.failIfNotTerminal).not.toHaveBeenCalled();
    });

    it('queries with a cutoff in the past by the configured grace window', async () => {
      // Arrange
      chatSessionRepo.findStaleStartingSessions.mockResolvedValue([]);
      const before = Date.now();

      // Act
      await service.cleanupStuckStartingSessions();

      // Assert
      expect(chatSessionRepo.findStaleStartingSessions).toHaveBeenCalledTimes(
        1,
      );
      const cutoff = chatSessionRepo.findStaleStartingSessions.mock
        .calls[0][0] as Date;
      expect(cutoff).toBeInstanceOf(Date);
      // Cutoff must be at least the grace window in the past.
      expect(cutoff.getTime()).toBeLessThanOrEqual(
        before - STARTING_STALE_GRACE_MS,
      );
    });

    it('calls failIfNotTerminal for stuck STARTING sessions with the stuck-starting reason', async () => {
      // Arrange
      chatSessionRepo.findStaleStartingSessions.mockResolvedValue([
        { id: 'stuck-1' },
        { id: 'stuck-2' },
      ]);
      chatSessionRepo.failIfNotTerminal.mockResolvedValue(true);

      // Act
      const result = await service.cleanupStuckStartingSessions();

      // Assert
      expect(result).toBe(2);
      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledWith(
        'stuck-1',
        {
          message: STUCK_STARTING_REASON,
        },
      );
      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledWith(
        'stuck-2',
        {
          message: STUCK_STARTING_REASON,
        },
      );
    });

    it('leaves already-terminal sessions alone — repo failIfNotTerminal returns false', async () => {
      // Arrange
      chatSessionRepo.findStaleStartingSessions.mockResolvedValue([
        { id: 'already-terminal' },
        { id: 'clean' },
      ]);
      chatSessionRepo.failIfNotTerminal
        .mockResolvedValueOnce(false) // already terminal
        .mockResolvedValueOnce(true); // successfully written

      // Act
      const result = await service.cleanupStuckStartingSessions();

      // Assert
      expect(result).toBe(1);
      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledTimes(2);
    });
  });

  describe('runCleanup', () => {
    it('prevents concurrent executions', async () => {
      // Arrange
      chatSessionRepo.findOrphanedSessions.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve([{ id: 'session-1' }]);
            }, 50);
          }),
      );
      chatSessionRepo.failIfNotTerminal.mockResolvedValue(true);

      // Act
      const first = service.runCleanup();
      const second = service.runCleanup();
      const [result1, result2] = await Promise.all([first, second]);

      // Assert
      expect(result1).toBe(1);
      expect(result2).toBe(0);
      expect(chatSessionRepo.findOrphanedSessions).toHaveBeenCalledTimes(1);
    });

    it('sums orphaned RUNNING and stuck STARTING cleanups', async () => {
      // Arrange
      chatSessionRepo.findOrphanedSessions.mockResolvedValue([
        { id: 'orphan-1' },
      ]);
      chatSessionRepo.findStaleStartingSessions.mockResolvedValue([
        { id: 'stuck-1' },
        { id: 'stuck-2' },
      ]);
      chatSessionRepo.failIfNotTerminal.mockResolvedValue(true);

      // Act
      const result = await service.runCleanup();

      // Assert
      expect(result).toBe(3);
    });
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
    findStaleStartingSessions: vi.fn(),
    findByWorkflowRunId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    failIfNotTerminal: vi.fn(),
  };
}
