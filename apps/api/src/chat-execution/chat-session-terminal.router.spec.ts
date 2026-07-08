import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChatSessionStatus } from '@nexus/core';
import { ChatSessionTerminalRouter } from './chat-session-terminal.router';
import { EXECUTION_EVENT_TYPES } from '../execution-lifecycle/execution-lifecycle.contracts';
import type { DomainEventEnvelope } from '../domain-events/domain-event-bus.types';

function fakeBus() {
  const handlers = new Map<string, (e: DomainEventEnvelope) => Promise<void>>();
  return {
    handlers,
    on: vi.fn((type: string, h: (e: DomainEventEnvelope) => Promise<void>) =>
      handlers.set(type, h),
    ),
    fire: (type: string, e: DomainEventEnvelope) => handlers.get(type)!(e),
  };
}

function makeEvent(
  aggregateId = 'exec-1',
  overrides: Partial<DomainEventEnvelope> = {},
): DomainEventEnvelope {
  return {
    eventId: 'ev-1',
    eventType: EXECUTION_EVENT_TYPES.completed,
    aggregateId,
    aggregateType: 'execution',
    payload: {},
    occurredAt: new Date(),
    ...overrides,
  };
}

describe('ChatSessionTerminalRouter', () => {
  let bus: ReturnType<typeof fakeBus>;
  let executionRepo: {
    findById: ReturnType<typeof vi.fn>;
  };
  let chatSessionRepo: {
    update: ReturnType<typeof vi.fn>;
    failIfNotTerminal: ReturnType<typeof vi.fn>;
  };
  let sessionHydration: {
    saveSessionForChat: ReturnType<typeof vi.fn>;
  };
  let eventEmitter: { emit: ReturnType<typeof vi.fn> };
  let router: ChatSessionTerminalRouter;

  beforeEach(() => {
    bus = fakeBus();
    executionRepo = { findById: vi.fn() };
    chatSessionRepo = {
      update: vi.fn().mockResolvedValue(null),
      failIfNotTerminal: vi.fn().mockResolvedValue(true),
    };
    sessionHydration = {
      saveSessionForChat: vi.fn().mockResolvedValue('tree-1'),
    };
    eventEmitter = { emit: vi.fn() };

    router = new ChatSessionTerminalRouter(
      bus as never,
      executionRepo as never,
      chatSessionRepo as never,
      sessionHydration as never,
      eventEmitter,
    );
    router.onModuleInit();
  });

  describe('execution.completed', () => {
    it('saves session and marks chat session COMPLETED for adhoc_chat', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-1',
        kind: 'adhoc_chat',
        chat_session_id: 'cs-1',
        container_id: 'container-1',
        error_message: null,
        failure_reason: null,
      });

      await bus.fire(EXECUTION_EVENT_TYPES.completed, makeEvent('exec-1'));

      expect(sessionHydration.saveSessionForChat).toHaveBeenCalledWith(
        'container-1',
        'cs-1',
      );
      expect(chatSessionRepo.update).toHaveBeenCalledWith(
        'cs-1',
        expect.objectContaining({
          status: ChatSessionStatus.COMPLETED,
          execution_state: 'completed',
          session_tree_id: 'tree-1',
          error_message: null,
          completed_at: expect.any(Date),
        }),
      );
    });

    it('saves session and marks chat session COMPLETED for workflow_chat', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-2',
        kind: 'workflow_chat',
        chat_session_id: 'cs-2',
        container_id: 'container-2',
        error_message: null,
        failure_reason: null,
      });

      await bus.fire(EXECUTION_EVENT_TYPES.completed, makeEvent('exec-2'));

      expect(sessionHydration.saveSessionForChat).toHaveBeenCalledWith(
        'container-2',
        'cs-2',
      );
      expect(chatSessionRepo.update).toHaveBeenCalledWith(
        'cs-2',
        expect.objectContaining({
          status: ChatSessionStatus.COMPLETED,
          execution_state: 'completed',
        }),
      );
    });

    it('marks COMPLETED without session_tree_id when container_id is absent', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-3',
        kind: 'adhoc_chat',
        chat_session_id: 'cs-3',
        container_id: null,
        error_message: null,
        failure_reason: null,
      });

      await bus.fire(EXECUTION_EVENT_TYPES.completed, makeEvent('exec-3'));

      expect(sessionHydration.saveSessionForChat).not.toHaveBeenCalled();
      expect(chatSessionRepo.update).toHaveBeenCalledWith(
        'cs-3',
        expect.objectContaining({
          status: ChatSessionStatus.COMPLETED,
          execution_state: 'completed',
        }),
      );
      expect(chatSessionRepo.update).toHaveBeenCalledWith(
        'cs-3',
        expect.not.objectContaining({ session_tree_id: expect.anything() }),
      );
    });

    it('still marks COMPLETED even when session hydration fails', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-4',
        kind: 'adhoc_chat',
        chat_session_id: 'cs-4',
        container_id: 'container-4',
        error_message: null,
        failure_reason: null,
      });
      sessionHydration.saveSessionForChat.mockRejectedValueOnce(
        new Error('container gone'),
      );

      await bus.fire(EXECUTION_EVENT_TYPES.completed, makeEvent('exec-4'));

      expect(chatSessionRepo.update).toHaveBeenCalledWith(
        'cs-4',
        expect.objectContaining({
          status: ChatSessionStatus.COMPLETED,
          execution_state: 'completed',
        }),
      );
    });

    it('ignores executions without a chat_session_id', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-5',
        kind: 'workflow_step',
        chat_session_id: null,
      });

      await bus.fire(EXECUTION_EVENT_TYPES.completed, makeEvent('exec-5'));

      expect(chatSessionRepo.update).not.toHaveBeenCalled();
      expect(sessionHydration.saveSessionForChat).not.toHaveBeenCalled();
    });

    it('ignores subagent completion (owned elsewhere)', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-6',
        kind: 'subagent',
        chat_session_id: 'cs-6',
        container_id: 'container-6',
      });

      await bus.fire(EXECUTION_EVENT_TYPES.completed, makeEvent('exec-6'));

      expect(chatSessionRepo.update).not.toHaveBeenCalled();
    });

    it('ignores workflow_step completion (owned elsewhere)', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-6b',
        kind: 'workflow_step',
        chat_session_id: 'cs-6b',
        container_id: 'container-6b',
      });

      await bus.fire(EXECUTION_EVENT_TYPES.completed, makeEvent('exec-6b'));

      expect(chatSessionRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('execution.failed', () => {
    it('marks chat session FAILED with structured error message via failIfNotTerminal', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-7',
        kind: 'adhoc_chat',
        chat_session_id: 'cs-7',
        container_id: null,
        failure_reason: 'agent_error',
        error_message: 'Agent crashed unexpectedly',
      });

      await bus.fire(
        EXECUTION_EVENT_TYPES.failed,
        makeEvent('exec-7', { eventType: EXECUTION_EVENT_TYPES.failed }),
      );

      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledWith('cs-7', {
        reason: 'agent_error',
        message: 'Agent crashed unexpectedly',
      });
      expect(chatSessionRepo.update).not.toHaveBeenCalled();
      expect(sessionHydration.saveSessionForChat).not.toHaveBeenCalled();
    });

    it('uses the single fallback message when execution has no error_message', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-8',
        kind: 'workflow_chat',
        chat_session_id: 'cs-8',
        container_id: null,
        failure_reason: 'idle_timeout',
        error_message: null,
      });

      await bus.fire(
        EXECUTION_EVENT_TYPES.failed,
        makeEvent('exec-8', { eventType: EXECUTION_EVENT_TYPES.failed }),
      );

      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledWith('cs-8', {
        reason: 'idle_timeout',
        message: 'Execution terminated',
      });
    });

    it('ignores executions without a chat_session_id on failure', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-9',
        kind: 'workflow_step',
        chat_session_id: null,
        failure_reason: 'step_failed',
        error_message: 'step blew up',
      });

      await bus.fire(
        EXECUTION_EVENT_TYPES.failed,
        makeEvent('exec-9', { eventType: EXECUTION_EVENT_TYPES.failed }),
      );

      expect(chatSessionRepo.failIfNotTerminal).not.toHaveBeenCalled();
    });

    it('marks the linked session FAILED for a subagent execution (absorbed cascade)', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-sub',
        kind: 'subagent',
        chat_session_id: 'cs-sub',
        container_id: null,
        failure_reason: 'container_lost',
        error_message: 'Execution container exited or was lost',
      });

      await bus.fire(
        EXECUTION_EVENT_TYPES.failed,
        makeEvent('exec-sub', { eventType: EXECUTION_EVENT_TYPES.failed }),
      );

      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledWith('cs-sub', {
        reason: 'container_lost',
        message: 'Execution container exited or was lost',
      });
    });

    it('emits no FAILED event when the session was already terminal (idempotent no-op)', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-dup',
        kind: 'adhoc_chat',
        chat_session_id: 'cs-dup',
        container_id: null,
        failure_reason: 'agent_error',
        error_message: 'boom',
      });
      chatSessionRepo.failIfNotTerminal.mockResolvedValueOnce(false);

      await bus.fire(
        EXECUTION_EVENT_TYPES.failed,
        makeEvent('exec-dup', { eventType: EXECUTION_EVENT_TYPES.failed }),
      );

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('execution.reaped', () => {
    it('marks chat session FAILED when a chat execution is reaped', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-10',
        kind: 'adhoc_chat',
        chat_session_id: 'cs-10',
        container_id: null,
        failure_reason: 'max_runtime_exceeded',
        error_message: 'Runtime limit reached',
      });

      await bus.fire(
        EXECUTION_EVENT_TYPES.reaped,
        makeEvent('exec-10', { eventType: EXECUTION_EVENT_TYPES.reaped }),
      );

      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledWith('cs-10', {
        reason: 'max_runtime_exceeded',
        message: 'Runtime limit reached',
      });
    });

    it('marks the linked session FAILED for a reaped subagent (Phase 1 parity)', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-11',
        kind: 'subagent',
        chat_session_id: 'cs-11',
        container_id: null,
        failure_reason: 'spawn_timeout',
        error_message: 'Execution did not reach running state',
      });

      await bus.fire(
        EXECUTION_EVENT_TYPES.reaped,
        makeEvent('exec-11', { eventType: EXECUTION_EVENT_TYPES.reaped }),
      );

      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledWith('cs-11', {
        reason: 'spawn_timeout',
        message: 'Execution did not reach running state',
      });
    });

    it('writes the chat session terminal state exactly once per reaped event', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-12',
        kind: 'subagent',
        chat_session_id: 'cs-12',
        container_id: null,
        failure_reason: 'container_lost',
        error_message: 'lost',
      });

      await bus.fire(
        EXECUTION_EVENT_TYPES.reaped,
        makeEvent('exec-12', { eventType: EXECUTION_EVENT_TYPES.reaped }),
      );

      expect(chatSessionRepo.failIfNotTerminal).toHaveBeenCalledTimes(1);
    });
  });

  describe('error resilience', () => {
    it('does not throw when executionRepo.findById rejects', async () => {
      executionRepo.findById.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        bus.fire(EXECUTION_EVENT_TYPES.completed, makeEvent('exec-err')),
      ).resolves.not.toThrow();

      expect(chatSessionRepo.update).not.toHaveBeenCalled();
    });

    it('does not throw when chatSessionRepo.update rejects on completed', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-err2',
        kind: 'adhoc_chat',
        chat_session_id: 'cs-err2',
        container_id: null,
      });
      chatSessionRepo.update.mockRejectedValueOnce(new Error('write failed'));

      await expect(
        bus.fire(EXECUTION_EVENT_TYPES.completed, makeEvent('exec-err2')),
      ).resolves.not.toThrow();
    });

    it('does not throw when failIfNotTerminal rejects on failed', async () => {
      executionRepo.findById.mockResolvedValue({
        id: 'exec-err3',
        kind: 'adhoc_chat',
        chat_session_id: 'cs-err3',
        container_id: null,
        failure_reason: 'agent_error',
        error_message: 'boom',
      });
      chatSessionRepo.failIfNotTerminal.mockRejectedValueOnce(
        new Error('write failed'),
      );

      await expect(
        bus.fire(
          EXECUTION_EVENT_TYPES.failed,
          makeEvent('exec-err3', { eventType: EXECUTION_EVENT_TYPES.failed }),
        ),
      ).resolves.not.toThrow();
    });
  });
});
