import { describe, expect, it, vi } from 'vitest';
import type { EventSubscriptionContribution } from '@nexus/plugin-sdk';
import type { PluginContributionRegistryService } from '../contributions/plugin-contribution-registry.service';
import type {
  PluginContributionCleanupRequest,
  PluginContributionProjectionInventoryEntry,
} from '../contributions/plugin-contribution.types';
import { PluginEventSubscriptionProjectionService } from './plugin-event-subscription-projection.service';

type MockRegistry = {
  listActiveContributionProjectionEntries: ReturnType<typeof vi.fn>;
  calculateCleanupProjectionCandidates: ReturnType<typeof vi.fn>;
};

function createEventSubscriptionContribution(
  overrides: Partial<EventSubscriptionContribution> = {},
): EventSubscriptionContribution {
  return {
    id: 'audit-subscription',
    type: 'event.subscription',
    displayName: 'Audit Subscription',
    config: {
      topics: ['workflow.run.completed.v1'],
      operation: 'handle',
      deliveryMode: 'non_blocking',
      retry: {
        maxAttempts: 3,
        initialDelayMs: 1000,
        backoffMultiplier: 2,
      },
    },
    ...overrides,
  };
}

function createEntry(
  overrides: Partial<PluginContributionProjectionInventoryEntry> = {},
): PluginContributionProjectionInventoryEntry {
  return {
    pluginId: 'acme.plugin',
    version: '1.0.0',
    contributionId: 'audit-subscription',
    type: 'event.subscription',
    displayName: 'Audit Subscription',
    contribution: createEventSubscriptionContribution(),
    runtimeTarget: {
      pluginId: 'acme.plugin',
      version: '1.0.0',
      contributionId: 'audit-subscription',
      operation: 'handle',
    },
    isolationMode: 'worker_process',
    permissions: [],
    projectionStatus: 'pending',
    lastValidationResult: { status: 'valid' },
    globalCapabilityName: 'plugin:acme.plugin:audit-subscription',
    ...overrides,
  } as PluginContributionProjectionInventoryEntry;
}

function createService(overrides: Partial<MockRegistry> = {}) {
  const registry: MockRegistry = {
    listActiveContributionProjectionEntries: vi.fn().mockResolvedValue([]),
    calculateCleanupProjectionCandidates: vi.fn().mockResolvedValue([]),
    ...overrides,
  };

  return {
    service: new PluginEventSubscriptionProjectionService(
      registry as unknown as PluginContributionRegistryService,
    ),
    registry,
  };
}

describe('PluginEventSubscriptionProjectionService', () => {
  it('projects valid event subscriptions from active contribution entries', async () => {
    const { service } = createService({
      listActiveContributionProjectionEntries: vi
        .fn()
        .mockResolvedValue([createEntry()]),
    });

    const result = await service.projectEnabledEventSubscriptions();

    expect(result).toEqual([
      expect.objectContaining({
        status: 'projected',
        pluginId: 'acme.plugin',
        contributionId: 'audit-subscription',
      }),
    ]);
    expect(service.listActiveSubscriptions()).toHaveLength(1);
  });

  it('rejects unknown internal topics', async () => {
    const { service } = createService({
      listActiveContributionProjectionEntries: vi.fn().mockResolvedValue([
        createEntry({
          contribution: createEventSubscriptionContribution({
            config: {
              topics: ['workflow.run.cancelled.v1'],
              operation: 'handle',
              deliveryMode: 'non_blocking',
              retry: {
                maxAttempts: 3,
                initialDelayMs: 1000,
                backoffMultiplier: 2,
              },
            },
          }),
        }),
      ]),
    });

    const [result] = await service.projectEnabledEventSubscriptions();

    expect(result).toEqual(
      expect.objectContaining({
        status: 'failed',
        reason: 'invalid_topic_pattern',
      }),
    );
  });

  it('rejects namespace impersonation', async () => {
    const { service } = createService({
      listActiveContributionProjectionEntries: vi.fn().mockResolvedValue([
        createEntry({
          contribution: createEventSubscriptionContribution({
            config: {
              topics: ['plugin.other-plugin.audit.created'],
              operation: 'handle',
              deliveryMode: 'non_blocking',
              retry: {
                maxAttempts: 3,
                initialDelayMs: 1000,
                backoffMultiplier: 2,
              },
            },
          }),
        }),
      ]),
    });

    const [result] = await service.projectEnabledEventSubscriptions();

    expect(result).toEqual(
      expect.objectContaining({
        status: 'failed',
        reason: 'namespace_impersonation',
      }),
    );
  });

  it('matches exact topics and wildcard topics', async () => {
    const { service } = createService({
      listActiveContributionProjectionEntries: vi.fn().mockResolvedValue([
        createEntry({
          contribution: createEventSubscriptionContribution({
            config: {
              topics: ['workflow.run.*', 'plugin.acme.plugin.audit.*'],
              operation: 'handle',
              deliveryMode: 'non_blocking',
              retry: {
                maxAttempts: 3,
                initialDelayMs: 1000,
                backoffMultiplier: 2,
              },
            },
          }),
        }),
      ]),
    });

    await service.projectEnabledEventSubscriptions();

    expect(
      service.findMatchingSubscriptions('workflow.run.completed.v1', {
        scopeId: 'scope-1',
      }),
    ).toHaveLength(1);
    expect(
      service.findMatchingSubscriptions('plugin.acme.plugin.audit.created', {
        scopeId: 'scope-1',
      }),
    ).toHaveLength(1);
  });

  it('skips subscriptions when filters do not match', async () => {
    const { service } = createService({
      listActiveContributionProjectionEntries: vi.fn().mockResolvedValue([
        createEntry({
          contribution: createEventSubscriptionContribution({
            config: {
              topics: ['workflow.run.completed.v1'],
              filters: { scopeId: 'scope-1' },
              operation: 'handle',
              deliveryMode: 'non_blocking',
              retry: {
                maxAttempts: 3,
                initialDelayMs: 1000,
                backoffMultiplier: 2,
              },
            },
          }),
        }),
      ]),
    });

    await service.projectEnabledEventSubscriptions();

    expect(
      service.findMatchingSubscriptions('workflow.run.completed.v1', {
        scopeId: 'scope-2',
      }),
    ).toHaveLength(0);
  });

  it('cleans up projected subscriptions by plugin id and version', async () => {
    const request: PluginContributionCleanupRequest = {
      pluginId: 'acme.plugin',
      version: '1.0.0',
    };
    const { service } = createService({
      listActiveContributionProjectionEntries: vi
        .fn()
        .mockResolvedValue([createEntry()]),
    });

    await service.projectEnabledEventSubscriptions();
    const cleanup = await service.cleanupPluginEventSubscriptions(request);

    expect(cleanup).toEqual([
      expect.objectContaining({
        status: 'cleaned',
        pluginId: 'acme.plugin',
        version: '1.0.0',
      }),
    ]);
    expect(service.listActiveSubscriptions()).toHaveLength(0);
  });
});
