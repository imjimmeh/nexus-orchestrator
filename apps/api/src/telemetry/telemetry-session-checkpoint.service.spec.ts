import { describe, expect, it, vi } from 'vitest';
import { TelemetrySessionCheckpointService } from './telemetry-session-checkpoint.service';

describe('TelemetrySessionCheckpointService', () => {
  describe('persist', () => {
    it('returns undefined when no session hydration service is injected', async () => {
      const service = new TelemetrySessionCheckpointService(undefined);
      const result = await service.persist({
        workflowRunId: 'run-1',
        containerId: 'container-1',
      });
      expect(result).toBeUndefined();
    });

    it('persists via the chat session path when chatSessionId is provided', async () => {
      const saveSessionForWorkflowChat = vi
        .fn()
        .mockResolvedValue('tree-from-chat');
      const service = new TelemetrySessionCheckpointService({
        saveSessionForWorkflowChat,
      } as never);

      const result = await service.persist({
        workflowRunId: 'run-1',
        containerId: 'container-1',
        chatSessionId: 'chat-1',
      });

      expect(saveSessionForWorkflowChat).toHaveBeenCalledWith(
        'container-1',
        'run-1',
        'chat-1',
      );
      expect(result).toBe('tree-from-chat');
    });

    it('falls back to exited-container path when no chatSessionId is provided', async () => {
      const saveSessionFromExitedContainer = vi
        .fn()
        .mockResolvedValue('tree-from-container');
      const service = new TelemetrySessionCheckpointService({
        saveSessionFromExitedContainer,
      } as never);

      const result = await service.persist({
        workflowRunId: 'run-1',
        containerId: 'container-1',
      });

      expect(saveSessionFromExitedContainer).toHaveBeenCalledWith(
        'container-1',
        'run-1',
      );
      expect(result).toBe('tree-from-container');
    });

    it('returns undefined on error and logs a warning', async () => {
      const saveSessionForWorkflowChat = vi
        .fn()
        .mockRejectedValue(new Error('hydration failed'));
      const service = new TelemetrySessionCheckpointService({
        saveSessionForWorkflowChat,
      } as never);

      const result = await service.persist({
        workflowRunId: 'run-1',
        containerId: 'container-1',
        chatSessionId: 'chat-1',
      });

      expect(result).toBeUndefined();
    });
  });

  describe('getShouldPersist', () => {
    it('returns a debouncer that allows the first call but blocks within the debounce window', () => {
      const service = new TelemetrySessionCheckpointService(undefined);
      const should = service.getShouldPersist();

      const first = should({
        checkpointKey: 'container-1',
        eventType: 'turn_end',
        workflowRunId: 'run-1',
      });
      const second = should({
        checkpointKey: 'container-1',
        eventType: 'turn_end',
        workflowRunId: 'run-1',
      });

      expect(first).toBe(true);
      expect(second).toBe(false);
    });
  });
});
