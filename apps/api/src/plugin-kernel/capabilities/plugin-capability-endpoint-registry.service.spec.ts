import { describe, expect, it, vi } from 'vitest';
import type { PluginContributionRegistryService } from '../contributions/plugin-contribution-registry.service';
import { PluginCapabilityEndpointRegistryService } from './plugin-capability-endpoint-registry.service';

function createEntry(overrides: Record<string, unknown> = {}) {
  return {
    pluginId: 'acme.plugin',
    version: '1.0.0',
    contributionId: 'audit-endpoint',
    type: 'capability.endpoint',
    displayName: 'Audit Endpoint',
    contribution: {
      id: 'audit-endpoint',
      type: 'capability.endpoint',
      displayName: 'Audit Endpoint',
      config: {
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        requiredPermissions: ['internal_capability:plugin.endpoint.invoke'],
        operation: 'invoke_audit',
        timeoutMs: 10_000,
        retryable: false,
        visibility: ['workflow', 'tool'],
      },
    },
    runtimeTarget: {
      pluginId: 'acme.plugin',
      version: '1.0.0',
      contributionId: 'audit-endpoint',
      operation: 'invoke_audit',
    },
    isolationMode: 'worker_process',
    permissions: [],
    projectionStatus: 'pending',
    lastValidationResult: { status: 'valid' },
    globalCapabilityName: 'plugin:acme.plugin:audit-endpoint',
    ...overrides,
  };
}

function createService(
  overrides: Partial<PluginContributionRegistryService> = {},
) {
  const contributionRegistry = {
    listActiveContributionProjectionEntries: vi.fn().mockResolvedValue([]),
    findContributionByVersion: vi.fn().mockResolvedValue(null),
    findContribution: vi.fn().mockResolvedValue(null),
    ...overrides,
  };

  return {
    service: new PluginCapabilityEndpointRegistryService(
      contributionRegistry as unknown as PluginContributionRegistryService,
    ),
    contributionRegistry,
  };
}

describe('PluginCapabilityEndpointRegistryService', () => {
  it('lists active capability endpoints', async () => {
    const { service } = createService({
      listActiveContributionProjectionEntries: vi
        .fn()
        .mockResolvedValue([createEntry()]),
    });

    const result = await service.listActiveEndpoints();

    expect(result).toEqual([
      expect.objectContaining({
        globalEndpointName: 'plugin:acme.plugin:audit-endpoint',
        contributionId: 'audit-endpoint',
      }),
    ]);
  });

  it('filters endpoint listings by visibility', async () => {
    const { service } = createService({
      listActiveContributionProjectionEntries: vi
        .fn()
        .mockResolvedValue([createEntry()]),
    });

    const result = await service.listActiveEndpoints({
      visibility: 'internal',
    });

    expect(result).toEqual([]);
  });

  it('resolves endpoint by global endpoint name', async () => {
    const { service } = createService({
      listActiveContributionProjectionEntries: vi
        .fn()
        .mockResolvedValue([createEntry()]),
    });

    const result = await service.findByGlobalEndpointName(
      'plugin:acme.plugin:audit-endpoint',
    );

    expect(result?.contributionId).toBe('audit-endpoint');
  });

  it('resolves endpoint by plugin and contribution id', async () => {
    const { service } = createService({
      findContributionByVersion: vi.fn().mockResolvedValue(createEntry()),
    });

    const result = await service.findByPluginContribution(
      'acme.plugin',
      'audit-endpoint',
      '1.0.0',
    );

    expect(result?.globalEndpointName).toBe(
      'plugin:acme.plugin:audit-endpoint',
    );
  });

  it('excludes inactive or invalid endpoint entries', async () => {
    const { service } = createService({
      listActiveContributionProjectionEntries: vi.fn().mockResolvedValue([
        createEntry(),
        createEntry({
          contributionId: 'other',
          type: 'tool',
          globalCapabilityName: 'plugin:acme.plugin:other',
        }),
        createEntry({
          contributionId: 'invalid-endpoint',
          lastValidationResult: {
            status: 'invalid',
            errorMessage: 'Invalid endpoint config',
          },
          globalCapabilityName: 'plugin:acme.plugin:invalid-endpoint',
        }),
      ]),
    });

    const result = await service.listActiveEndpoints();

    expect(result).toHaveLength(1);
    expect(result[0]?.contributionId).toBe('audit-endpoint');
  });
});
