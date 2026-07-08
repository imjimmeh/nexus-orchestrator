import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisPubSubService } from './redis-pubsub.service';

const mockPublish = vi.fn().mockResolvedValue(1);
const mockSubscribe = vi.fn().mockResolvedValue('OK');
const mockUnsubscribe = vi.fn().mockResolvedValue('OK');

type MessageHandler = (channel: string, message: string) => void;
const messageHandlers: MessageHandler[] = [];

const mockSubscriberOn = vi.fn((event: string, handler: MessageHandler) => {
  if (event === 'message') {
    messageHandlers.push(handler);
  }
});

const mockDuplicate = vi.fn(() => ({
  on: mockSubscriberOn,
  subscribe: mockSubscribe,
  unsubscribe: mockUnsubscribe,
  disconnect: vi.fn(),
}));

const mockRedis = {
  publish: mockPublish,
  duplicate: mockDuplicate,
};

function buildService(): RedisPubSubService {
  return new RedisPubSubService(mockRedis);
}

function emitMessage(channel: string, payload: unknown): void {
  const message = JSON.stringify(payload);
  for (const handler of messageHandlers) {
    handler(channel, message);
  }
}

describe('RedisPubSubService – generic channel methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageHandlers.length = 0;
  });

  describe('publishToChannel', () => {
    it('publishes a JSON-serialised payload to the exact channel', async () => {
      const service = buildService();
      const payload = { type: 'wi-updated', id: 'proj-1' };

      await service.publishToChannel('wi:proj-1', payload);

      expect(mockPublish).toHaveBeenCalledOnce();
      expect(mockPublish).toHaveBeenCalledWith(
        'wi:proj-1',
        JSON.stringify(payload),
      );
    });
  });

  describe('subscribeToRawChannel', () => {
    it('subscribes to Redis and invokes callback with parsed payload when a message arrives', () => {
      const service = buildService();
      const cb = vi.fn();
      const payload = { event: 'moved', resourceId: 'wi-42' };

      service.subscribeToRawChannel('wi:proj-1', cb);
      emitMessage('wi:proj-1', payload);

      expect(mockSubscribe).toHaveBeenCalledWith('wi:proj-1');
      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith(payload);
    });

    it('does NOT invoke callback for messages on a different channel', () => {
      const service = buildService();
      const cb = vi.fn();

      service.subscribeToRawChannel('wi:proj-1', cb);
      emitMessage('wi:proj-2', { event: 'other' });

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribeFromRawChannel', () => {
    it('removes the callback and calls redis.unsubscribe when no listeners remain', () => {
      const service = buildService();
      const cb = vi.fn();

      service.subscribeToRawChannel('wi:proj-1', cb);
      service.unsubscribeFromRawChannel('wi:proj-1', cb);

      expect(mockUnsubscribe).toHaveBeenCalledWith('wi:proj-1');

      // callback must no longer be invoked
      emitMessage('wi:proj-1', { event: 'after-unsub' });
      expect(cb).not.toHaveBeenCalled();
    });

    it('does NOT call redis.unsubscribe when other listeners remain on the same channel', () => {
      const service = buildService();
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      service.subscribeToRawChannel('wi:proj-1', cb1);
      service.subscribeToRawChannel('wi:proj-1', cb2);
      service.unsubscribeFromRawChannel('wi:proj-1', cb1);

      expect(mockUnsubscribe).not.toHaveBeenCalled();

      // cb2 must still receive messages
      emitMessage('wi:proj-1', { event: 'still-live' });
      expect(cb2).toHaveBeenCalledOnce();
      expect(cb1).not.toHaveBeenCalled();
    });
  });
});
