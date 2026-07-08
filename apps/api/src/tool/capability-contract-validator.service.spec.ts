import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CapabilityContractValidatorService } from './capability-contract-validator.service';
import { CapabilityRegistryService } from '../capability-infra/capability-registry.service';
import { ToolRegistryRepository } from './database/repositories/tool-registry.repository';

describe('CapabilityContractValidatorService', () => {
  let service: CapabilityContractValidatorService;
  let repository: { findAll: ReturnType<typeof vi.fn> };
  let capabilityRegistry: {
    getDiscoveredEntries: ReturnType<typeof vi.fn>;
    getDiscoveredBridgeActions: ReturnType<typeof vi.fn>;
    getSeededCapabilityEntries: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const allBridgeActions = new Set([
      'spawn_subagent_async',
      'wait_for_subagents',
      'check_subagent_status',
      'update_external',
      'step_complete',
      'mention_agent',
      'check_agent_mentions',
      'resolve_agent_thread',
      'invite_agent_to_chat',
      'open_war_room',
      'invite_war_room_participant',
      'post_war_room_message',
      'update_war_room_blackboard',
      'submit_war_room_signoff',
      'get_war_room_state',
      'close_war_room',
    ]);

    const seededEntries = [
      {
        name: 'capability_a',
        seedInRegistry: true,
        schema: { type: 'object' },
      },
      {
        name: 'capability_b',
        seedInRegistry: true,
        schema: { type: 'object' },
      },
    ];

    capabilityRegistry = {
      getDiscoveredEntries: vi.fn().mockReturnValue(seededEntries),
      getDiscoveredBridgeActions: vi.fn().mockReturnValue(allBridgeActions),
      getSeededCapabilityEntries: vi.fn().mockReturnValue(seededEntries),
    };

    repository = {
      findAll: vi
        .fn()
        .mockResolvedValue(
          seededEntries.map((entry) => ({ name: entry.name })),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CapabilityContractValidatorService,
        {
          provide: ToolRegistryRepository,
          useValue: repository,
        },
        {
          provide: CapabilityRegistryService,
          useValue: capabilityRegistry,
        },
      ],
    }).compile();

    service = module.get(CapabilityContractValidatorService);
  });

  it('passes when seeded capabilities exist in registry', async () => {
    const report = await service.validateContracts();
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('fails when a seeded capability is missing from registry', async () => {
    const seededEntries = [
      { name: 'capability_a', seedInRegistry: true },
      { name: 'capability_b', seedInRegistry: true },
    ];
    const firstSeedName = seededEntries[0].name;
    repository.findAll.mockResolvedValueOnce(
      seededEntries
        .filter((e) => e.name !== firstSeedName)
        .map((entry) => ({ name: entry.name })),
    );

    const report = await service.validateContracts();

    expect(report.ok).toBe(false);
    expect(report.errors.some((entry) => entry.includes(firstSeedName))).toBe(
      true,
    );
  });

  it('fails when a discovered capability resolves to an empty schema', async () => {
    capabilityRegistry.getDiscoveredEntries.mockReturnValueOnce([
      {
        name: 'set_job_output',
        seedInRegistry: true,
        schema: {},
        transport: 'api_callback',
        apiCallback: {
          method: 'POST',
          pathTemplate: '/api/workflow-runtime/jobs/set-output',
        },
      },
    ]);
    capabilityRegistry.getSeededCapabilityEntries.mockReturnValueOnce([
      { name: 'set_job_output', seedInRegistry: true },
    ]);
    repository.findAll.mockResolvedValueOnce([{ name: 'set_job_output' }]);

    const report = await service.validateContracts();

    expect(report.ok).toBe(false);
    expect(
      report.errors.some((entry) =>
        entry.includes('set_job_output resolved to an empty JSON schema'),
      ),
    ).toBe(true);
  });

  describe('validateNoDuplicateNames', () => {
    it('should detect duplicate capability names', async () => {
      capabilityRegistry.getDiscoveredEntries.mockReturnValue([
        {
          name: 'capability_a',
          seedInRegistry: true,
          bridgeAction: 'spawn_subagent_async',
        },
        { name: 'capability_b', seedInRegistry: true },
        { name: 'capability_a', seedInRegistry: true },
      ]);

      await expect(service.validateContracts()).rejects.toThrow(
        'Duplicate capability names: capability_a',
      );
    });
  });

  describe('validateBridgeParity', () => {
    it('should validate bridge action parity from discovery', async () => {
      capabilityRegistry.getDiscoveredEntries.mockReturnValue([
        {
          name: 'capability_a',
          seedInRegistry: true,
          schema: { type: 'object' },
          bridgeAction: 'update_external',
        },
      ]);
      capabilityRegistry.getDiscoveredBridgeActions.mockReturnValue(
        new Set(['spawn_subagent_async', 'wait_for_subagents']),
      );

      const report = await service.validateContracts();

      expect(report.ok).toBe(false);
      expect(
        report.errors.some((entry) =>
          entry.includes('references bridge action'),
        ),
      ).toBe(true);
    });

    it('should pass when all bridge actions are discovered', async () => {
      const allBridgeActions = new Set([
        'spawn_subagent_async',
        'wait_for_subagents',
        'check_subagent_status',
        'update_external',
        'step_complete',
        'mention_agent',
        'check_agent_mentions',
        'resolve_agent_thread',
        'invite_agent_to_chat',
        'open_war_room',
        'invite_war_room_participant',
        'post_war_room_message',
        'update_war_room_blackboard',
        'submit_war_room_signoff',
        'get_war_room_state',
        'close_war_room',
      ]);
      capabilityRegistry.getDiscoveredBridgeActions.mockReturnValueOnce(
        allBridgeActions,
      );
      capabilityRegistry.getDiscoveredEntries.mockReturnValueOnce([
        {
          name: 'capability_a',
          seedInRegistry: true,
          schema: { type: 'object' },
          bridgeAction: 'spawn_subagent_async',
        },
        {
          name: 'capability_b',
          seedInRegistry: true,
          schema: { type: 'object' },
          bridgeAction: 'wait_for_subagents',
        },
      ]);

      const report = await service.validateContracts();

      expect(report.ok).toBe(true);
    });
  });
});
