import { Test, TestingModule } from '@nestjs/testing';
import { RedisPubSubService } from '../redis/redis-pubsub.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { Redis } from 'ioredis';
import { Mock, vi } from 'vitest';

describe('RedisPubSubService', () => {
  let service: RedisPubSubService;
  let mockPublisher: Partial<Redis>;
  let mockSubscriber: Partial<Redis>;

  beforeEach(async () => {
    mockSubscriber = {
      on: vi.fn(),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    };

    mockPublisher = {
      duplicate: vi.fn().mockReturnValue(mockSubscriber),
      publish: vi.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisPubSubService,
        {
          provide: REDIS_CLIENT,
          useValue: mockPublisher,
        },
      ],
    }).compile();

    service = module.get<RedisPubSubService>(RedisPubSubService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should publish event', async () => {
    await service.publishEvent('wf-1', { type: 'test' });
    expect(mockPublisher.publish).toHaveBeenCalledWith(
      'telemetry:wf-1',
      '{"type":"test"}',
    );
  });

  it('should subscribe and unsubscribe', async () => {
    const cb = vi.fn() as unknown as (message: string) => void;
    await service.subscribeToChannel('wf-2', cb);
    expect(mockSubscriber.subscribe as Mock).toHaveBeenCalledWith(
      'telemetry:wf-2',
    );

    await service.unsubscribeFromChannel('wf-2', cb);
    expect(mockSubscriber.unsubscribe as Mock).toHaveBeenCalledWith(
      'telemetry:wf-2',
    );
  });
});
