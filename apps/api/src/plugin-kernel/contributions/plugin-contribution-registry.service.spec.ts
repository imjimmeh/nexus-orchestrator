import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginRegistryEntry } from '../database/entities/plugin-registry-entry.entity';
import { PluginRegistryEntryRepository } from '../database/repositories/plugin-registry-entry.repository';
import { PluginContributionRegistryService } from './plugin-contribution-registry.service';

type MockPluginRegistryEntryRepository = {
  listActiveEntries: ReturnType<typeof vi.fn>;
  listEntriesForPlugin: ReturnType<typeof vi.fn>;
  findByPluginIdAndVersion: ReturnType<typeof vi.fn>;
};

function buildEntry(
  overrides: Partial<PluginRegistryEntry> = {},
): PluginRegistryEntry {
  return {
    id: 'entry-1',
    plugin_id: 'com.acme.workflow-tools',
    version: '1.2.3',
    name: 'Acme Workflow Tools',
    description: 'Workflow helpers',
    author: 'Acme',
    source_type: 'package',
    source: '@acme/workflow-tools',
    lifecycle_state: 'enabled',
    enabled: true,
    trust_level: 'third_party',
    isolation_mode: 'worker_process',
    requested_permissions: [{ kind: 'network', hosts: ['api.acme.test'] }],
    granted_permissions: [{ kind: 'network', hosts: ['api.acme.test'] }],
    scan_result: null,
    compatibility_result: null,
    contributions: [
      {
        id: 'summarize',
        type: 'tool',
        displayName: 'Summarize',
        config: {
          inputSchema: { type: 'object' },
          operation: 'execute',
        },
      },
    ],
    last_error: null,
    installed_at: new Date('2026-05-17T12:00:00.000Z'),
    scanned_at: new Date('2026-05-17T12:05:00.000Z'),
    enabled_at: new Date('2026-05-17T12:10:00.000Z'),
    disabled_at: null,
    quarantined_at: null,
    uninstalled_at: null,
    metadata: { package_name: '@acme/workflow-tools' },
    created_at: new Date('2026-05-17T12:00:00.000Z'),
    updated_at: new Date('2026-05-17T12:10:00.000Z'),
    ...overrides,
  };
}

describe('PluginContributionRegistryService', () => {
  let service: PluginContributionRegistryService;
  let repository: MockPluginRegistryEntryRepository;

  beforeEach(async () => {
    repository = {
      listActiveEntries: vi.fn(),
      listEntriesForPlugin: vi.fn(),
      findByPluginIdAndVersion: vi.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        PluginContributionRegistryService,
        { provide: PluginRegistryEntryRepository, useValue: repository },
      ],
    }).compile();

    service = module.get(PluginContributionRegistryService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('builds inspectable inventory entries from persisted active registry rows', async () => {
    repository.listActiveEntries.mockResolvedValue([buildEntry()]);

    const inventory = await service.listActiveContributions();

    expect(inventory).toEqual([
      expect.objectContaining({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        contributionId: 'summarize',
        type: 'tool',
        displayName: 'Summarize',
        runtimeTarget: {
          pluginId: 'com.acme.workflow-tools',
          version: '1.2.3',
          contributionId: 'summarize',
          operation: 'execute',
        },
        isolationMode: 'worker_process',
        permissions: [{ kind: 'network', hosts: ['api.acme.test'] }],
        projectionStatus: 'pending',
        lastValidationResult: { status: 'valid' },
        globalCapabilityName: 'plugin:com.acme.workflow-tools:summarize',
      }),
    ]);
    expect(repository.listActiveEntries).toHaveBeenCalledWith({
      state: 'enabled',
      enabled: true,
    });
  });

  it.each(['disabled', 'quarantined', 'uninstalled'] as const)(
    'excludes %s plugins from the active inventory by default',
    async (lifecycleState) => {
      repository.listActiveEntries.mockResolvedValue([
        buildEntry({ lifecycle_state: lifecycleState }),
      ]);

      await expect(service.listActiveContributions()).resolves.toEqual([]);
    },
  );

  it.each(['discovered', 'installed', 'scanned'] as const)(
    'excludes %s plugins from the active inventory by default',
    async (lifecycleState) => {
      repository.listActiveEntries.mockResolvedValue([
        buildEntry({ lifecycle_state: lifecycleState, enabled: false }),
      ]);

      await expect(service.listActiveContributions()).resolves.toEqual([]);
    },
  );

  it('excludes rows with enabled false from the active inventory', async () => {
    repository.listActiveEntries.mockResolvedValue([
      buildEntry({ lifecycle_state: 'enabled', enabled: false }),
    ]);

    await expect(service.listActiveContributions()).resolves.toEqual([]);
  });

  it('rejects duplicate contribution ids within the same plugin with a stable reason', async () => {
    repository.listActiveEntries.mockResolvedValue([
      buildEntry({
        contributions: [
          {
            id: 'summarize',
            type: 'tool',
            displayName: 'Summarize',
            config: { inputSchema: { type: 'object' } },
          },
          {
            id: 'summarize',
            type: 'workflow.step',
            displayName: 'Summarize Step',
            config: {
              stepType: 'acme.summarize',
              inputContract: 'SummaryInput',
            },
          },
        ],
      }),
    ]);

    await expect(service.listActiveContributions()).rejects.toThrow(
      new BadRequestException(
        'Duplicate contribution id "summarize" for plugin "com.acme.workflow-tools"',
      ),
    );
  });

  it('rejects duplicate contribution ids after SDK normalization', async () => {
    repository.listActiveEntries.mockResolvedValue([
      buildEntry({
        contributions: [
          {
            id: 'summarize',
            type: 'tool',
            displayName: 'Summarize',
            config: { inputSchema: { type: 'object' } },
          },
          {
            id: ' summarize ',
            type: 'workflow.step',
            displayName: 'Summarize Step',
            config: {
              stepType: 'acme.summarize',
              inputContract: 'SummaryInput',
            },
          },
        ],
      }),
    ]);

    await expect(service.listActiveContributions()).rejects.toThrow(
      new BadRequestException(
        'Duplicate contribution id "summarize" for plugin "com.acme.workflow-tools"',
      ),
    );
  });

  it('namespaces global capability names to avoid cross-plugin contribution id conflicts', async () => {
    repository.listActiveEntries.mockResolvedValue([
      buildEntry({ plugin_id: 'com.acme.one' }),
      buildEntry({ id: 'entry-2', plugin_id: 'com.acme.two' }),
    ]);

    const inventory = await service.listActiveContributions();

    expect(inventory.map((entry) => entry.globalCapabilityName)).toEqual([
      'plugin:com.acme.one:summarize',
      'plugin:com.acme.two:summarize',
    ]);
  });

  it('encodes global capability name segments to avoid colon delimiter collisions', async () => {
    repository.listActiveEntries.mockResolvedValue([
      buildEntry({
        plugin_id: 'a:b',
        contributions: [
          {
            id: 'c',
            type: 'tool',
            displayName: 'Tool C',
            config: { inputSchema: { type: 'object' } },
          },
        ],
      }),
      buildEntry({
        id: 'entry-2',
        plugin_id: 'a',
        contributions: [
          {
            id: 'b:c',
            type: 'tool',
            displayName: 'Tool BC',
            config: { inputSchema: { type: 'object' } },
          },
        ],
      }),
    ]);

    const inventory = await service.listActiveContributions();

    expect(inventory.map((entry) => entry.globalCapabilityName)).toEqual([
      'plugin:a%3Ab:c',
      'plugin:a:b%3Ac',
    ]);
    await expect(
      service.findContributionByGlobalCapabilityName('plugin:a%3Ab:c'),
    ).resolves.toEqual(
      expect.objectContaining({
        pluginId: 'a:b',
        contributionId: 'c',
        globalCapabilityName: 'plugin:a%3Ab:c',
      }),
    );
    await expect(
      service.findContributionByGlobalCapabilityName('plugin:a:b%3Ac'),
    ).resolves.toEqual(
      expect.objectContaining({
        pluginId: 'a',
        contributionId: 'b:c',
        globalCapabilityName: 'plugin:a:b%3Ac',
      }),
    );
  });

  it('rejects invalid persisted contribution shapes using SDK contribution schemas', async () => {
    repository.listActiveEntries.mockResolvedValue([
      buildEntry({
        contributions: [
          {
            id: 'broken',
            type: 'tool',
            displayName: 'Broken Tool',
            config: {},
          },
        ],
      }),
    ]);

    await expect(service.listActiveContributions()).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.listActiveContributions()).rejects.toThrow(
      'Invalid contribution "broken" for plugin "com.acme.workflow-tools"',
    );
  });

  it('finds one contribution by plugin and contribution id', async () => {
    repository.listActiveEntries.mockResolvedValue([buildEntry()]);

    await expect(
      service.findContribution('com.acme.workflow-tools', 'summarize'),
    ).resolves.toEqual(
      expect.objectContaining({
        pluginId: 'com.acme.workflow-tools',
        contributionId: 'summarize',
      }),
    );
    await expect(
      service.findContribution('com.acme.workflow-tools', 'missing'),
    ).resolves.toBeNull();
  });

  it('finds one active contribution by plugin, version, and contribution id', async () => {
    repository.findByPluginIdAndVersion.mockResolvedValue(buildEntry());

    await expect(
      service.findContributionByVersion(
        'com.acme.workflow-tools',
        '1.2.3',
        'summarize',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        contributionId: 'summarize',
      }),
    );
    expect(repository.findByPluginIdAndVersion).toHaveBeenCalledWith(
      'com.acme.workflow-tools',
      '1.2.3',
    );
  });

  it('finds one active contribution by exact global capability name and version', async () => {
    repository.listActiveEntries.mockResolvedValue([
      buildEntry({ version: '1.0.0' }),
      buildEntry({ id: 'entry-2', version: '2.0.0' }),
    ]);

    await expect(
      service.findContributionByGlobalCapabilityName(
        'plugin:com.acme.workflow-tools:summarize',
        '2.0.0',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        version: '2.0.0',
        globalCapabilityName: 'plugin:com.acme.workflow-tools:summarize',
      }),
    );
  });

  it('does not return an arbitrary contribution for ambiguous unversioned global capability lookup', async () => {
    repository.listActiveEntries.mockResolvedValue([
      buildEntry({ version: '1.0.0' }),
      buildEntry({ id: 'entry-2', version: '2.0.0' }),
    ]);

    await expect(
      service.findContributionByGlobalCapabilityName(
        'plugin:com.acme.workflow-tools:summarize',
      ),
    ).resolves.toBeNull();
  });

  it('finds all active contributions by exact global capability name', async () => {
    repository.listActiveEntries.mockResolvedValue([
      buildEntry({ version: '1.0.0' }),
      buildEntry({ id: 'entry-2', version: '2.0.0' }),
    ]);

    await expect(
      service.findContributionsByGlobalCapabilityName(
        'plugin:com.acme.workflow-tools:summarize',
      ),
    ).resolves.toEqual([
      expect.objectContaining({ version: '1.0.0' }),
      expect.objectContaining({ version: '2.0.0' }),
    ]);
  });

  it('calculates cleanup candidates for a plugin lifecycle change without mutating state', async () => {
    repository.listEntriesForPlugin.mockResolvedValue([buildEntry()]);

    const candidates = await service.calculateCleanupCandidates({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
    });

    expect(candidates).toEqual([
      {
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        contributionId: 'summarize',
        type: 'tool',
        globalCapabilityName: 'plugin:com.acme.workflow-tools:summarize',
        projectionStatus: 'pending',
      },
    ]);
    expect(repository.listEntriesForPlugin).toHaveBeenCalledWith(
      'com.acme.workflow-tools',
      '1.2.3',
    );
  });

  it.each(['disabled', 'quarantined', 'uninstalled'] as const)(
    'calculates cleanup candidates for %s plugins with persisted contributions',
    async (lifecycleState) => {
      repository.listActiveEntries.mockResolvedValue([]);
      repository.listEntriesForPlugin.mockResolvedValue([
        buildEntry({ lifecycle_state: lifecycleState, enabled: false }),
      ]);

      const candidates = await service.calculateCleanupCandidates({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
      });

      expect(candidates).toEqual([
        {
          pluginId: 'com.acme.workflow-tools',
          version: '1.2.3',
          contributionId: 'summarize',
          type: 'tool',
          globalCapabilityName: 'plugin:com.acme.workflow-tools:summarize',
          projectionStatus: 'pending',
        },
      ]);
    },
  );
});
