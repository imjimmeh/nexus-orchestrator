import { Test, TestingModule } from '@nestjs/testing';
import { RedisStreamService } from '../redis/redis-stream.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { Redis } from 'ioredis';
import { vi } from 'vitest';

describe('RedisStreamService', () => {
  let service: RedisStreamService;
  let mockRedis: Partial<Redis>;

  beforeEach(async () => {
    mockRedis = {
      xadd: vi.fn().mockResolvedValue('12345-0'),
      xrange: vi
        .fn()
        .mockResolvedValue([
          ['12345-0', ['event_type', 'test', 'payload', '{"a":1}']],
        ]),
      xtrim: vi.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisStreamService,
        {
          provide: REDIS_CLIENT,
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<RedisStreamService>(RedisStreamService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should persist event', async () => {
    await service.persistEvent('wf-1', {
      event_type: 'test',
      payload: { a: 1 },
    });
    expect(mockRedis.xadd).toHaveBeenCalled();
  });

  it('should get event history', async () => {
    const history = await service.getEventHistory('wf-1');
    expect(history.length).toBe(1);
    expect(history[0].event_type).toBe('test');
  });
});
