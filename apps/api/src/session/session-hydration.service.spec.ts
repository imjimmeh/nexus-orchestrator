import { vi } from 'vitest';
import type { Mock } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { SessionHydrationService } from './session-hydration.service';
import { ContainerOrchestratorService } from '../docker/container-orchestrator.service';
import { PiSessionTreeRepository } from '../runtime/database/repositories/pi-session-tree.repository';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';
import { JSONLValidationService } from './jsonl-validation.service';
import { DOCKER_CLIENT } from '../docker/docker.constants';
import { SecretScannerService } from '../security/secret-scanner.service';
import { TokenCounterService } from '../memory/token-counter.service';
import { DistillationThresholdService } from '../memory/distillation-threshold.service';
import { MemoryTokenBudgetResolver } from '../memory/memory-token-budget.resolver';
import { getQueueToken } from '@nestjs/bullmq';
import { AiConfigurationService } from '../ai-config/ai-configuration.service';
import { TELEMETRY_GATEWAY } from '../shared/interfaces/telemetry-gateway.interface';
import { CONTAINER_SESSION_PATH } from '@nexus/core';

describe('SessionHydrationService', () => {
  let service: SessionHydrationService;
  let mockContainer: {
    inspect: Mock;
    getArchive: Mock;
    putArchive: Mock;
    start: Mock;
  };
  let mockDocker: {
    getContainer: Mock;
  };
  let mockSessionRepo: {
    create: Mock;
    findById: Mock;
  };
  let mockChatSessionRepo: {
    update: Mock;
  };

  beforeEach(async () => {
    const mockContainerOrchestrator = {
      killContainer: vi.fn().mockResolvedValue(undefined),
      removeContainer: vi.fn().mockResolvedValue(undefined),
      getContainerStatus: vi.fn().mockResolvedValue({}),
    };

    mockSessionRepo = {
      create: vi.fn().mockResolvedValue({ id: 'tree-1' }),
      findById: vi.fn().mockResolvedValue({
        id: 'tree-1',
        jsonl_data: [
          Buffer.from(
            'eJyrVkrLz1eyUkpKLFKyqlZKSkzOzkxJVbJSKkqtyC/IT1Wyio420lEqTkosSVXSUMpJzUvNK+ECACvSEK0=',
            'base64',
          ).toString('base64'),
        ],
        // the above is gzip of '{"id":"1","type":"user"}'
      }),
    };

    mockContainer = {
      inspect: vi.fn().mockResolvedValue({
        Config: {
          Labels: { 'nexus.tier': 'LIGHT' },
          Env: [],
        },
      }),
      getArchive: vi.fn().mockResolvedValue({
        pipe: vi.fn(),
        on: vi.fn(),
      }),
      putArchive: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
    };

    mockDocker = {
      getContainer: vi.fn().mockReturnValue(mockContainer),
    };

    mockChatSessionRepo = {
      update: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionHydrationService,
        JSONLValidationService,
        SecretScannerService,
        TokenCounterService,
        {
          provide: AiConfigurationService,
          useValue: {
            getModelForUseCase: vi.fn().mockResolvedValue('test-model'),
            getTokenLimit: vi.fn().mockResolvedValue(128000),
            buildProviderEnvByModel: vi.fn().mockResolvedValue({}),
          },
        },
        {
          // TokenCounterService depends on MemoryTokenBudgetResolver at
          // index [1] in its constructor (work item ddfdcead wired the
          // model-aware resolver into the counter). Provide a noop
          // resolver so the real TokenCounterService can be instantiated
          // without pulling in the full ai-config plumbing — the
          // session-hydration tests don't exercise token counting, they
          // exercise the enqueue / persistence pipeline.
          provide: MemoryTokenBudgetResolver,
          useValue: {
            resolve: vi.fn().mockResolvedValue({
              contextWindow: 128_000,
              memory: 76_800,
              working: 38_400,
              reserved: 12_800,
              memoryPercent: 60,
              workingPercent: 30,
              reservedPercent: 10,
            }),
          },
        },
        {
          provide: ContainerOrchestratorService,
          useValue: mockContainerOrchestrator,
        },
        { provide: PiSessionTreeRepository, useValue: mockSessionRepo },
        { provide: ChatSessionRepository, useValue: mockChatSessionRepo },
        { provide: DOCKER_CLIENT, useValue: mockDocker },
        {
          provide: DistillationThresholdService,
          useValue: {
            resolve: vi
              .fn()
              .mockResolvedValue({ value: 0.8, source: 'default' }),
          },
        },
        {
          provide: getQueueToken('distillation'),
          useValue: { add: vi.fn().mockResolvedValue({ id: 'job-1' }) },
        },
        {
          provide: TELEMETRY_GATEWAY,
          useValue: {
            sendDehydrateCommand: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<SessionHydrationService>(SessionHydrationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('resolves configured SESSION_PATH first, then defaults', async () => {
    mockContainer.inspect.mockResolvedValue({
      Config: {
        Env: ['SESSION_PATH=/custom/.pi/agent/session.jsonl'],
      },
    });

    const candidates = await (
      service as unknown as {
        resolveSessionFileCandidates: (
          containerId: string,
        ) => Promise<string[]>;
      }
    ).resolveSessionFileCandidates('container-1');

    expect(candidates).toEqual([
      '/custom/.pi/agent/session.jsonl',
      CONTAINER_SESSION_PATH,
      '/opt/pi-runner/.pi/agent/session.jsonl',
      '/app/.pi/agent/session.jsonl',
      '/workspace/.pi/agent/session.jsonl',
    ]);
  });

  it('resolves SESSION_PATH directory for archive injection', async () => {
    mockContainer.inspect.mockResolvedValue({
      Config: {
        Env: ['SESSION_PATH=/opt/pi-runner/.pi/agent/session.jsonl'],
      },
    });

    const directories = await (
      service as unknown as {
        resolveSessionDirectoryCandidates: (
          containerId: string,
        ) => Promise<string[]>;
      }
    ).resolveSessionDirectoryCandidates('container-1');

    expect(directories).toContain('/opt/pi-runner/.pi/agent/');
  });

  it('persists workflow chat sessions and links chat_sessions.session_tree_id', async () => {
    const extractAndPersistSessionSpy = vi
      .spyOn(service, 'extractAndPersistSession')
      .mockResolvedValue('tree-1');

    const result = await service.saveSessionForWorkflowChat(
      'container-1',
      'workflow-1',
      'chat-1',
    );

    expect(result).toBe('tree-1');
    expect(extractAndPersistSessionSpy).toHaveBeenCalledWith(
      'container-1',
      expect.objectContaining({
        workflow_run_id: 'workflow-1',
        chat_session_id: 'chat-1',
      }),
    );
    expect(mockChatSessionRepo.update).toHaveBeenCalledWith('chat-1', {
      session_tree_id: 'tree-1',
    });
  });

  // Note: Full dehydration test is hard to mock due to tar stream extraction logic.
  // Full integration test should cover it.

  describe('saveSessionFromJsonl', () => {
    it('persists a valid jsonl string and returns a sessionTreeId', async () => {
      const validJsonl = [
        JSON.stringify({ id: 'root', type: 'root', parentId: null }),
        JSON.stringify({ id: 'node1', type: 'user', parentId: 'root' }),
      ].join('\n');

      mockSessionRepo.create.mockResolvedValueOnce({ id: 'fresh-tree-1' });

      const treeId = await service.saveSessionFromJsonl(validJsonl, {
        workflow_run_id: 'run-xyz',
      });

      expect(treeId).toBe('fresh-tree-1');
      expect(mockSessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow_run_id: 'run-xyz',
        }),
      );
    });

    it('stores container_tier=1 (LIGHT) when no explicit tier is provided', async () => {
      const validJsonl = [
        JSON.stringify({ id: 'root', type: 'root', parentId: null }),
      ].join('\n');

      mockSessionRepo.create.mockResolvedValueOnce({ id: 'tree-light' });

      await service.saveSessionFromJsonl(validJsonl, {
        workflow_run_id: 'run-light',
      });

      expect(mockSessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ container_tier: 1 }),
      );
    });

    it('stores container_tier=2 (HEAVY) when options.containerTier=2 is passed', async () => {
      const validJsonl = [
        JSON.stringify({ id: 'root', type: 'root', parentId: null }),
      ].join('\n');

      mockSessionRepo.create.mockResolvedValueOnce({ id: 'tree-heavy' });

      await service.saveSessionFromJsonl(
        validJsonl,
        { workflow_run_id: 'run-heavy' },
        { containerTier: 2 },
      );

      expect(mockSessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ container_tier: 2 }),
      );
    });

    it('rejects malformed jsonl (non-JSON line)', async () => {
      await expect(
        service.saveSessionFromJsonl('not json at all', {
          workflow_run_id: 'run-bad2',
        }),
      ).rejects.toThrow();
    });
  });
});
