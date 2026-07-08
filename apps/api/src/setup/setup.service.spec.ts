import { ToolPolicyEffect } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { SetupService } from './setup.service';

function identityRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return value;
}

describe('SetupService', () => {
  const secretRepo = {
    count: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(identityRecord),
    save: vi.fn(),
  };
  const providerRepo = {
    count: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(identityRecord),
    save: vi.fn(),
  };
  const modelRepo = {
    count: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(identityRecord),
    save: vi.fn(),
    createQueryBuilder: vi.fn(),
  };
  const profileRepo = {
    findOne: vi.fn(),
    create: vi.fn(identityRecord),
    save: vi.fn(),
  };
  const setupConfigRepo = {
    findOne: vi.fn(),
    create: vi.fn(identityRecord),
    save: vi.fn(),
    update: vi.fn(),
  };

  const manager = {
    getRepository: vi.fn((entity: { name: string }) => {
      if (entity.name === 'SecretStore') return secretRepo;
      if (entity.name === 'LlmProvider') return providerRepo;
      if (entity.name === 'LlmModel') return modelRepo;
      if (entity.name === 'AgentProfile') return profileRepo;
      if (entity.name === 'SetupConfig') return setupConfigRepo;
      throw new Error(`Unknown repository: ${entity.name}`);
    }),
  };

  const dataSource = {
    getRepository: manager.getRepository,
    transaction: vi.fn((cb: (currentManager: typeof manager) => unknown) =>
      cb(manager),
    ),
  } as unknown as DataSource;

  const vault = {
    encrypt: vi.fn((value: string) => `enc:${value}`),
  };

  const scopedVariableSeedService = {
    seed: vi.fn(),
  };

  const workflowSeedService = {
    seed: vi.fn(),
  };

  const agentProfilesFileSeedService = {
    loadDefinitions: vi.fn(),
  };

  let service: SetupService;

  beforeEach(() => {
    vi.clearAllMocks();
    scopedVariableSeedService.seed.mockResolvedValue(undefined);
    workflowSeedService.seed.mockResolvedValue(undefined);
    agentProfilesFileSeedService.loadDefinitions.mockReturnValue({
      definitions: [
        {
          name: 'architect-agent',
          system_prompt: 'Architect setup prompt',
          tier_preference: 'heavy',
          tool_policy: {
            rules: [{ effect: ToolPolicyEffect.ALLOW, tools: ['read'] }],
          },
          assigned_skills: [],
          is_active: true,
        },
      ],
      seedRoot: '/seed/agents',
      usedLegacyAssignments: false,
    });

    service = new SetupService(
      dataSource,
      vault as never,
      scopedVariableSeedService as never,
      workflowSeedService as never,
      agentProfilesFileSeedService as never,
    );
  });

  it('returns requiresSetup=true for admins when setup is incomplete', async () => {
    setupConfigRepo.findOne.mockResolvedValue(null);
    setupConfigRepo.save.mockResolvedValue({ requires_setup: true });
    secretRepo.count.mockResolvedValue(0);
    providerRepo.count.mockResolvedValue(0);
    modelRepo.count.mockResolvedValue(0);
    profileRepo.findOne.mockResolvedValue(null);

    const result = await service.getStatus(['admin']);

    expect(result.requiresSetup).toBe(true);
    expect(result.hasAnySecret).toBe(false);
    expect(result.hasActiveProvider).toBe(false);
    expect(result.hasActiveModel).toBe(false);
    expect(result.hasArchitectProfile).toBe(false);
  });

  it('returns requiresSetup=false for non-admin users', async () => {
    setupConfigRepo.findOne.mockResolvedValue({ requires_setup: false });
    secretRepo.count.mockResolvedValue(0);
    providerRepo.count.mockResolvedValue(0);
    modelRepo.count.mockResolvedValue(0);
    profileRepo.findOne.mockResolvedValue(null);

    const result = await service.getStatus(['user']);

    expect(result.requiresSetup).toBe(false);
  });

  it('rejects initialize for non-admin users', async () => {
    await expect(
      service.initialize(['user'], {
        providerName: 'chutes.ai',
        secretValue: 'secret',
        modelName: 'MiniMaxAI/MiniMax-M2.5-TEE',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('initializes setup and creates missing records', async () => {
    const queryBuilder = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    };

    setupConfigRepo.update.mockResolvedValue(undefined);
    secretRepo.findOne.mockResolvedValue(null);
    secretRepo.save.mockResolvedValue({
      id: 'secret-1',
      name: 'chutes.ai-primary',
    });

    providerRepo.findOne.mockResolvedValue(null);
    providerRepo.save.mockResolvedValue({
      id: 'provider-1',
      name: 'chutes.ai',
    });

    modelRepo.createQueryBuilder.mockReturnValue(queryBuilder);
    modelRepo.findOne.mockResolvedValue(null);
    modelRepo.save.mockResolvedValue({
      id: 'model-1',
      name: 'MiniMaxAI/MiniMax-M2.5-TEE',
    });

    profileRepo.findOne.mockResolvedValue(null);
    profileRepo.save.mockResolvedValue({ id: 'profile-1' });

    const result = await service.initialize(['admin'], {
      providerName: 'chutes.ai',
      providerBaseUrl: 'https://llm.chutes.ai/v1/',
      secretValue: 'seed-secret',
      modelName: 'MiniMaxAI/MiniMax-M2.5-TEE',
      tokenLimit: 128000,
    });

    expect(result).toEqual({ initialized: true });
    expect(vault.encrypt).toHaveBeenCalled();
    expect(queryBuilder.execute).toHaveBeenCalled();
    expect(secretRepo.save).toHaveBeenCalled();
    expect(providerRepo.save).toHaveBeenCalled();
    expect(modelRepo.save).toHaveBeenCalled();
    expect(profileRepo.save).toHaveBeenCalled();
    expect(setupConfigRepo.update).toHaveBeenCalled();
    expect(workflowSeedService.seed).toHaveBeenCalled();
  });
});
