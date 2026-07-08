import { ToolPolicyEffect } from '@nexus/core';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFactoryService } from './agent-factory.service';

describe('AgentFactoryService', () => {
  const findByNameInsensitiveMock = vi.fn();
  const createProfileMock = vi.fn();
  const findAllToolsMock = vi.fn();
  const findModelByNameMock = vi.fn();
  const findProviderByNameMock = vi.fn();
  const emitBestEffortMock = vi.fn();
  const loadSeedDefinitionsMock = vi.fn();
  const refreshPoliciesMock = vi.fn();

  const agentProfiles = {
    findByNameInsensitive: findByNameInsensitiveMock,
    create: createProfileMock,
  };

  const toolRegistry = {
    findAll: findAllToolsMock,
  };

  const modelRepo = {
    findByName: findModelByNameMock,
  };

  const providerRepo = {
    findByName: findProviderByNameMock,
  };

  const eventLedger = {
    emitBestEffort: emitBestEffortMock,
  };

  const fileSeedService = {
    loadDefinitions: loadSeedDefinitionsMock,
  };

  const iamPolicyService = {
    refreshPolicies: refreshPoliciesMock,
  };

  const capabilityRegistry = {
    getDiscoveredEntries: vi.fn().mockReturnValue([]),
  };

  let service: AgentFactoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    findByNameInsensitiveMock.mockResolvedValue(null);
    createProfileMock.mockResolvedValue({
      id: 'profile-1',
      name: 'spec-specialist',
      source: 'agent_factory',
    });
    findAllToolsMock.mockResolvedValue([{ name: 'query_memory' }]);
    findModelByNameMock.mockResolvedValue(null);
    findProviderByNameMock.mockResolvedValue(null);
    emitBestEffortMock.mockResolvedValue(undefined);
    loadSeedDefinitionsMock.mockReturnValue({
      definitions: [{ name: 'ceo-agent' }],
      seedRoot: '/seed/agents',
      usedLegacyAssignments: false,
    });
    refreshPoliciesMock.mockResolvedValue(undefined);
    capabilityRegistry.getDiscoveredEntries.mockReturnValue([]);

    service = new AgentFactoryService(
      agentProfiles as never,
      toolRegistry as never,
      modelRepo as never,
      providerRepo as never,
      eventLedger as never,
      fileSeedService as never,
      iamPolicyService as never,
      capabilityRegistry as never,
    );
  });

  it('creates a valid runtime profile with provenance', async () => {
    const created = await service.createProfile({
      name: 'Spec Specialist',
      system_prompt: 'You are a focused specialist for spec drafting.',
      tier_preference: 'heavy',
      allowed_tools: ['query_memory'],
      created_by_profile: 'ceo-agent',
      created_by_workflow_run_id: 'run-1',
      factory_context: { reason: 'spec decomposition' },
    });

    expect(createProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'spec-specialist',
        source: 'agent_factory',
        created_by_profile: 'ceo-agent',
        created_by_workflow_run_id: 'run-1',
        tool_policy: {
          default: ToolPolicyEffect.DENY,
          rules: [{ effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' }],
        },
      }),
    );
    expect(created).toEqual(
      expect.objectContaining({
        id: 'profile-1',
        name: 'spec-specialist',
      }),
    );
    expect(refreshPoliciesMock).toHaveBeenCalledTimes(1);
    expect(emitBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'agent.factory.create.attempted',
        outcome: 'in_progress',
      }),
    );
    expect(emitBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'agent.factory.create.succeeded',
        outcome: 'success',
      }),
    );
  });

  it('rejects duplicate profile names', async () => {
    findByNameInsensitiveMock.mockResolvedValueOnce({
      id: 'existing-1',
      name: 'spec-specialist',
    });

    await expect(
      service.createProfile({
        name: 'spec-specialist',
        system_prompt: 'You are a focused specialist for spec drafting.',
        allowed_tools: ['query_memory'],
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(emitBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'agent.factory.create.denied',
        outcome: 'denied',
      }),
    );
  });

  it('rejects reserved seeded names', async () => {
    await expect(
      service.createProfile({
        name: 'ceo-agent',
        system_prompt: 'Reserved names should not be allowed.',
        allowed_tools: ['query_memory'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects protected profile prefixes', async () => {
    await expect(
      service.createProfile({
        name: 'nexus-specialist',
        system_prompt: 'Protected prefixes should be blocked.',
        allowed_tools: ['query_memory'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown tools', async () => {
    await expect(
      service.createProfile({
        name: 'qa-helper',
        system_prompt: 'Tool checks should fail for unknown names.',
        allowed_tools: ['not_real_tool'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects wildcard allowed_tools', async () => {
    await expect(
      service.createProfile({
        name: 'wide-open-agent',
        system_prompt: 'Wildcard should be denied.',
        allowed_tools: ['*'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects missing allowed_tools', async () => {
    await expect(
      service.createProfile({
        name: 'missing-tools',
        system_prompt: 'Allowed tools are required.',
        allowed_tools: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists supports_vision: true when provided', async () => {
    await service.createProfile({
      name: 'vision-specialist',
      allowed_tools: ['query_memory'],
      supports_vision: true,
    });

    expect(createProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supports_vision: true,
      }),
    );
  });

  it('defaults supports_vision to false when not provided', async () => {
    await service.createProfile({
      name: 'standard-agent',
      allowed_tools: ['query_memory'],
    });

    expect(createProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supports_vision: false,
      }),
    );
  });
});
