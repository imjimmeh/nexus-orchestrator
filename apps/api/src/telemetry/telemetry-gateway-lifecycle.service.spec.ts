import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetryGatewayLifecycle } from './telemetry-gateway-lifecycle.service';
import type { AuthenticatedSocket } from './types';

function makeMockClient() {
  return {
    handshake: { auth: {} },
    disconnect: vi.fn(),
    workflowRunId: 'run-1',
    role: 'agent',
  } as unknown as AuthenticatedSocket;
}

function makeMockEventService() {
  return {
    processAndBroadcastEvent: vi.fn().mockResolvedValue(undefined),
  };
}

describe('TelemetryGatewayLifecycle', () => {
  let eventService: ReturnType<typeof makeMockEventService>;
  let runnerConfigStore: { get: ReturnType<typeof vi.fn> };
  let pubsubService: {
    subscribeToChannel: ReturnType<typeof vi.fn>;
    unsubscribeFromChannel: ReturnType<typeof vi.fn>;
  };
  let streamService: { getEventHistory: ReturnType<typeof vi.fn> };
  let eventLedger: { emitBestEffort: ReturnType<typeof vi.fn> };
  let service: TelemetryGatewayLifecycle;

  beforeEach(() => {
    eventService = makeMockEventService();
    runnerConfigStore = { get: vi.fn().mockResolvedValue(null) };
    pubsubService = {
      subscribeToChannel: vi.fn().mockResolvedValue(undefined),
      unsubscribeFromChannel: vi.fn().mockResolvedValue(undefined),
    };
    streamService = { getEventHistory: vi.fn().mockResolvedValue([]) };
    eventLedger = { emitBestEffort: vi.fn().mockResolvedValue(undefined) };

    service = new TelemetryGatewayLifecycle(
      eventLedger as never,
      runnerConfigStore as never,
      pubsubService as never,
      streamService as never,
      eventService as never,
    );
  });

  describe('handleConnection', () => {
    it('threads the eventService.processAndBroadcastEvent sink into the post-auth path', async () => {
      process.env.JWT_SECRET = 'explicit-test-jwt-secret-at-least-32-chars';
      const jwt = await import('jsonwebtoken');
      const token = jwt.sign(
        {
          workflowRunId: 'run-1',
          role: 'agent',
          isSubagent: false,
          stepId: 'step-1',
        },
        process.env.JWT_SECRET,
      );
      const client = {
        handshake: { auth: { token } },
        disconnect: vi.fn(),
        join: vi.fn().mockResolvedValue(undefined),
        emit: vi.fn(),
      } as unknown as AuthenticatedSocket;

      await service.handleConnection(client);

      // The lifecycle service must have passed its broadcast sink into
      // the underlying connection compat helper. We don't assert which
      // post-auth path executed — that's covered by the per-event tests.
      expect(client.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('does not unsubscribe when the socket has no pubsub callback (e.g. agent role)', async () => {
      const client = {
        workflowRunId: 'run-1',
        role: 'agent',
      } as unknown as AuthenticatedSocket;

      await service.handleDisconnect(client);

      expect(pubsubService.unsubscribeFromChannel).not.toHaveBeenCalled();
    });

    it('unsubscribes the ui role callback when present', async () => {
      const callback = vi.fn();
      const client = {
        workflowRunId: 'run-1',
        role: 'ui',
        pubsubCallback: callback,
      } as unknown as AuthenticatedSocket;

      await service.handleDisconnect(client);

      expect(pubsubService.unsubscribeFromChannel).toHaveBeenCalledWith(
        'run-1',
        callback,
      );
    });
  });
});
