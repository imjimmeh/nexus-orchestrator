import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RedisPubSubService } from '../redis/redis-pubsub.service';
import { OAuthLoginSessionBusService } from './oauth-login-session.bus.service';

type SubscribeWrapper = (payload: unknown) => void;

describe('OAuthLoginSessionBusService', () => {
  let subscribeToRawChannel: ReturnType<typeof vi.fn>;
  let publishToChannel: ReturnType<typeof vi.fn>;
  let service: OAuthLoginSessionBusService;

  beforeEach(() => {
    subscribeToRawChannel = vi.fn();
    publishToChannel = vi.fn().mockResolvedValue(undefined);

    const redisPubSub = {
      subscribeToRawChannel,
      publishToChannel,
    } as unknown as RedisPubSubService;

    service = new OAuthLoginSessionBusService(redisPubSub);
  });

  describe('subscribeToCode', () => {
    it('subscribes to the namespaced code channel with a JSON-parsing wrapper', () => {
      const callback = vi.fn();

      service.subscribeToCode('sess-1', callback);

      expect(subscribeToRawChannel).toHaveBeenCalledTimes(1);
      const [channel, wrapper] = subscribeToRawChannel.mock.calls[0] as [
        string,
        SubscribeWrapper,
      ];
      expect(channel).toBe('oauth:session:sess-1:code');
      expect(typeof wrapper).toBe('function');

      wrapper('{"code":"good"}');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('good');
    });

    it('invokes the original callback with the code from a pre-parsed object payload', () => {
      const callback = vi.fn();

      service.subscribeToCode('sess-1', callback);
      const wrapper = subscribeToRawChannel.mock.calls[0]?.[1] as
        | SubscribeWrapper
        | undefined;

      expect(wrapper).toBeDefined();
      wrapper?.({ code: 'parsed-good' });
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('parsed-good');
    });

    it('does NOT invoke the original callback when the payload is malformed JSON', () => {
      const callback = vi.fn();

      service.subscribeToCode('sess-1', callback);
      const wrapper = subscribeToRawChannel.mock.calls[0]?.[1] as
        | SubscribeWrapper
        | undefined;

      wrapper?.('{not-json');
      wrapper?.('{"unterminated":');
      expect(callback).not.toHaveBeenCalled();
    });

    it('does NOT invoke the original callback when the envelope is missing the code field', () => {
      const callback = vi.fn();

      service.subscribeToCode('sess-1', callback);
      const wrapper = subscribeToRawChannel.mock.calls[0]?.[1] as
        | SubscribeWrapper
        | undefined;

      wrapper?.('{"other":"field"}');
      wrapper?.('{"code":42}');
      wrapper?.('{"code":null}');
      wrapper?.('{"code":["a","b"]}');
      expect(callback).not.toHaveBeenCalled();
    });

    it('does NOT invoke the original callback for unsupported payload types', () => {
      const callback = vi.fn();

      service.subscribeToCode('sess-1', callback);
      const wrapper = subscribeToRawChannel.mock.calls[0]?.[1] as
        | SubscribeWrapper
        | undefined;

      wrapper?.(42);
      wrapper?.(null);
      wrapper?.(undefined);
      wrapper?.([1, 2, 3]);
      expect(callback).not.toHaveBeenCalled();
    });

    it('does NOT invoke the original callback when a JSON string parses to a non-object value', () => {
      const callback = vi.fn();

      service.subscribeToCode('sess-1', callback);
      const wrapper = subscribeToRawChannel.mock.calls[0]?.[1] as
        | SubscribeWrapper
        | undefined;

      wrapper?.('"a plain string"');
      wrapper?.('42');
      wrapper?.('null');
      wrapper?.('[1,2,3]');
      expect(callback).not.toHaveBeenCalled();
    });

    it('namespaces the channel per sessionId so sessions do not share a pub/sub topic', () => {
      const callback = vi.fn();

      service.subscribeToCode('alpha', callback);
      service.subscribeToCode('beta', callback);

      const channels = subscribeToRawChannel.mock.calls.map((call) => call[0]);
      expect(channels).toEqual([
        'oauth:session:alpha:code',
        'oauth:session:beta:code',
      ]);
    });
  });

  describe('publishCode', () => {
    it('publishes to the namespaced code channel with the { code } envelope', async () => {
      await service.publishCode('sess-1', 'value');

      expect(publishToChannel).toHaveBeenCalledTimes(1);
      expect(publishToChannel).toHaveBeenCalledWith(
        'oauth:session:sess-1:code',
        { code: 'value' },
      );
    });

    it('returns the promise from publishToChannel', async () => {
      await service.publishCode('sess-1', 'value');

      expect(publishToChannel).toHaveBeenCalledTimes(1);
      expect(publishToChannel).toHaveBeenCalledWith(
        'oauth:session:sess-1:code',
        { code: 'value' },
      );
    });

    it('namespaces the channel per sessionId on the publish path', async () => {
      await service.publishCode('alpha', 'a-code');
      await service.publishCode('beta', 'b-code');

      expect(publishToChannel).toHaveBeenNthCalledWith(
        1,
        'oauth:session:alpha:code',
        { code: 'a-code' },
      );
      expect(publishToChannel).toHaveBeenNthCalledWith(
        2,
        'oauth:session:beta:code',
        { code: 'b-code' },
      );
    });
  });
});
