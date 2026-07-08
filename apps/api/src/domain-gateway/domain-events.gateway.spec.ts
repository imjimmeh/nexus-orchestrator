import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import * as jwt from 'jsonwebtoken';
import { DomainEventsGateway } from './domain-events.gateway';
import { RedisPubSubService } from '../redis/redis-pubsub.service';

const TEST_JWT_SECRET = 'test-secret';
const makeToken = () =>
  jwt.sign({ userId: 'user-1', sub: 'user-1' }, TEST_JWT_SECRET, {
    expiresIn: '1h',
  });

// Mock RedisPubSubService — captures callbacks so we can fire them manually
const subscribedCallbacks = new Map<string, Set<(p: unknown) => void>>();
const mockPubSub = {
  subscribeToRawChannel: vi.fn((channel: string, cb: (p: unknown) => void) => {
    if (!subscribedCallbacks.has(channel))
      subscribedCallbacks.set(channel, new Set());
    subscribedCallbacks.get(channel)!.add(cb);
  }),
  unsubscribeFromRawChannel: vi.fn(
    (channel: string, cb: (p: unknown) => void) => {
      subscribedCallbacks.get(channel)?.delete(cb);
    },
  ),
};

function fireRedisMessage(channel: string, payload: unknown) {
  subscribedCallbacks.get(channel)?.forEach((cb) => {
    cb(payload);
  });
}

describe('DomainEventsGateway (integration)', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    process.env['JWT_SECRET'] = TEST_JWT_SECRET;
    subscribedCallbacks.clear();

    const module = await Test.createTestingModule({
      providers: [
        DomainEventsGateway,
        { provide: RedisPubSubService, useValue: mockPubSub },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
  });

  afterAll(() => app.close());

  function connect(token?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const s = io(`http://localhost:${port}/domain-events`, {
        auth: token ? { token } : {},
        transports: ['websocket'],
      });
      s.on('connect', () => {
        resolve(s);
      });
      s.on('connect_error', reject);
      setTimeout(() => {
        reject(new Error('connect timeout'));
      }, 3000);
    });
  }

  it('rejects connections with invalid JWT', () => {
    return new Promise<void>((resolve) => {
      const s = io(`http://localhost:${port}/domain-events`, {
        auth: { token: 'bad-token' },
        transports: ['websocket'],
      });
      s.on('disconnect', () => {
        s.close();
        resolve();
      });
      s.on('connect_error', () => {
        s.close();
        resolve();
      });
    });
  });

  it('accepts connections with valid JWT', async () => {
    const client = await connect(makeToken());
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('subscribes to ri:{scopeId} on Redis when client emits join-scope', async () => {
    const client = await connect(makeToken());
    client.emit('join-scope', { scopeId: 'scope-1' });
    await new Promise((r) => setTimeout(r, 100));
    expect(mockPubSub.subscribeToRawChannel).toHaveBeenCalledWith(
      'ri:scope-1',
      expect.any(Function),
    );
    client.disconnect();
  });

  it('emits resource-updated to client when Redis fires a message', async () => {
    const client = await connect(makeToken());
    client.emit('join-scope', { scopeId: 'scope-2' });
    await new Promise((r) => setTimeout(r, 100));

    const received = await new Promise<unknown>((resolve) => {
      client.on('resource-updated', resolve);
      fireRedisMessage('ri:scope-2', {
        scopeId: 'scope-2',
        resource: { id: 'res-42', status: 'DONE' },
      });
    });

    expect(received).toMatchObject({
      scopeId: 'scope-2',
      resource: { id: 'res-42' },
    });
    client.disconnect();
  });

  it('unsubscribes from Redis on client disconnect', async () => {
    const client = await connect(makeToken());
    client.emit('join-scope', { scopeId: 'scope-3' });
    await new Promise((r) => setTimeout(r, 100));
    client.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    expect(mockPubSub.unsubscribeFromRawChannel).toHaveBeenCalledWith(
      'ri:scope-3',
      expect.any(Function),
    );
  });
});
