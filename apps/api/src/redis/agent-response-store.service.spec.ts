import { Test, TestingModule } from '@nestjs/testing';
import { AgentResponseStoreService } from './agent-response-store.service';
import { REDIS_CLIENT } from './redis.constants';
import { vi } from 'vitest';

describe('AgentResponseStoreService', () => {
  let service: AgentResponseStoreService;

  const redisMock = {
    set: vi.fn().mockResolvedValue('OK'),
    getdel: vi.fn().mockResolvedValue(null),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentResponseStoreService,
        { provide: REDIS_CLIENT, useValue: redisMock },
      ],
    }).compile();

    service = module.get<AgentResponseStoreService>(AgentResponseStoreService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('store', () => {
    it('should store response with default TTL', async () => {
      await service.store('wf-1', 'step-1', 'Agent response text');

      expect(redisMock.set).toHaveBeenCalledWith(
        'agent-response:wf-1:step-1',
        'Agent response text',
        'EX',
        600,
      );
    });

    it('should store response with custom TTL', async () => {
      await service.store('wf-2', 'step-a', 'Custom TTL response', 120);

      expect(redisMock.set).toHaveBeenCalledWith(
        'agent-response:wf-2:step-a',
        'Custom TTL response',
        'EX',
        120,
      );
    });
  });

  describe('pop', () => {
    it('should return null when no response exists', async () => {
      redisMock.getdel.mockResolvedValueOnce(null);

      const result = await service.pop('wf-1', 'step-1');

      expect(result).toBeNull();
      expect(redisMock.getdel).toHaveBeenCalledWith(
        'agent-response:wf-1:step-1',
      );
    });

    it('should return response and delete the key', async () => {
      redisMock.getdel.mockResolvedValueOnce('Stored agent text');

      const result = await service.pop('wf-1', 'step-1');

      expect(result).toBe('Stored agent text');
      expect(redisMock.getdel).toHaveBeenCalledWith(
        'agent-response:wf-1:step-1',
      );
    });
  });

  describe('storeStepComplete', () => {
    it('should store step-complete response with default TTL', async () => {
      await service.storeStepComplete('wf-1', 'job-1', 'Step done');

      expect(redisMock.set).toHaveBeenCalledWith(
        'step-complete:wf-1:job-1',
        'Step done',
        'EX',
        600,
      );
    });

    it('should store step-complete response with custom TTL', async () => {
      await service.storeStepComplete('wf-2', 'job-a', 'Custom TTL', 120);

      expect(redisMock.set).toHaveBeenCalledWith(
        'step-complete:wf-2:job-a',
        'Custom TTL',
        'EX',
        120,
      );
    });
  });

  describe('popStepComplete', () => {
    it('should return null when no step-complete response exists', async () => {
      redisMock.getdel.mockResolvedValueOnce(null);

      const result = await service.popStepComplete('wf-1', 'job-1');

      expect(result).toBeNull();
      expect(redisMock.getdel).toHaveBeenCalledWith('step-complete:wf-1:job-1');
    });

    it('should return step-complete response and delete the key', async () => {
      redisMock.getdel.mockResolvedValueOnce('Step finished');

      const result = await service.popStepComplete('wf-1', 'job-1');

      expect(result).toBe('Step finished');
      expect(redisMock.getdel).toHaveBeenCalledWith('step-complete:wf-1:job-1');
    });
  });
});
