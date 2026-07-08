import { describe, expect, it, vi } from 'vitest';
import type { WorkflowHookContribution } from '@nexus/plugin-sdk';
import type { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';
import type { PluginContributionRegistryService } from './plugin-contribution-registry.service';
import type {
  PluginContributionInventoryEntry,
  PluginContributionProjectionInventoryEntry,
} from './plugin-contribution.types';
import { PluginWorkflowHookProjectionService } from './plugin-workflow-hook-projection.service';

function createWorkflowHookContribution(
  config: Partial<WorkflowHookContribution['config']> = {},
): WorkflowHookContribution {
  return {
    id: 'audit-workflow',
    type: 'workflow.hook',
    displayName: 'Audit workflow lifecycle',
    config: {
      events: ['workflow.run.completed'],
      filters: { scopeId: 'scope-1' },
      blocking: false,
      operation: 'handle_workflow_hook',
      ...config,
    },
  };
}

function createProjectionEntry(
  contribution: WorkflowHookContribution = createWorkflowHookContribution(),
  overrides: Partial<PluginContributionInventoryEntry> = {},
): PluginContributionInventoryEntry {
  return {
    pluginId: 'acme.plugin',
    version: '1.2.3',
    contributionId: contribution.id,
    type: contribution.type,
    displayName: contribution.displayName,
    contribution,
    runtimeTarget: {
      pluginId: 'acme.plugin',
      version: '1.2.3',
      contributionId: contribution.id,
      operation: contribution.config.operation,
    },
    isolationMode: 'worker_process',
    permissions: [],
    projectionStatus: 'pending',
    lastValidationResult: { status: 'valid' },
    globalCapabilityName: 'plugin:acme.plugin:audit-workflow',
    ...overrides,
  };
}

function createContributionRegistry(
  entries: PluginContributionProjectionInventoryEntry[],
): PluginContributionRegistryService {
  return {
    listActiveContributionProjectionEntries: vi.fn().mockResolvedValue(entries),
    calculateCleanupProjectionCandidates: vi.fn().mockResolvedValue(entries),
  } as unknown as PluginContributionRegistryService;
}

function createInvalidProjectionEntry(): PluginContributionProjectionInventoryEntry {
  return {
    pluginId: 'acme.plugin',
    version: '1.2.3',
    contributionId: 'audit-workflow',
    type: 'workflow.hook',
    displayName: 'Audit workflow lifecycle',
    contribution: {
      id: 'audit-workflow',
      type: 'workflow.hook',
      displayName: 'Audit workflow lifecycle',
      config: { events: ['workflow.run.deleted'] },
    },
    runtimeTarget: {
      pluginId: 'acme.plugin',
      version: '1.2.3',
      contributionId: 'audit-workflow',
      operation: 'handle_workflow_hook',
    },
    isolationMode: 'worker_process',
    permissions: [],
    projectionStatus: 'pending',
    lastValidationResult: {
      status: 'invalid',
      errorMessage: 'Invalid workflow hook contribution',
    },
    globalCapabilityName: 'plugin:acme.plugin:audit-workflow',
  };
}

function createRuntimeManager(
  result: Awaited<ReturnType<PluginRuntimeManagerService['deliverEvent']>> = {
    ok: true,
  },
): PluginRuntimeManagerService {
  return {
    deliverEvent: vi.fn().mockResolvedValue(result),
  } as unknown as PluginRuntimeManagerService;
}

describe('PluginWorkflowHookProjectionService', () => {
  it('projects valid workflow hook contributions into inspectable subscriptions', async () => {
    const service = new PluginWorkflowHookProjectionService(
      createContributionRegistry([createProjectionEntry()]),
      createRuntimeManager(),
    );

    const results = await service.projectEnabledWorkflowHooks();

    expect(results).toEqual([
      {
        status: 'projected',
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'audit-workflow',
        eventName: 'workflow.run.completed',
        topic: 'workflow.run.completed',
      },
    ]);
    expect(service.listHookSubscriptions()).toEqual([
      expect.objectContaining({
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'audit-workflow',
        eventName: 'workflow.run.completed',
        topic: 'workflow.run.completed',
        operation: 'handle_workflow_hook',
        blocking: false,
        filters: { scopeId: 'scope-1' },
        status: 'active',
      }),
    ]);
  });

  it('rejects workflow hook contributions with unapproved lifecycle event names', async () => {
    const invalidContribution = {
      id: 'audit-workflow',
      type: 'workflow.hook',
      displayName: 'Audit workflow lifecycle',
      config: {
        events: ['workflow.run.deleted'],
        blocking: false,
        operation: 'handle_workflow_hook',
      },
    };
    const service = new PluginWorkflowHookProjectionService(
      createContributionRegistry([
        createProjectionEntry(invalidContribution as WorkflowHookContribution),
      ]),
      createRuntimeManager(),
    );

    await expect(service.projectEnabledWorkflowHooks()).resolves.toEqual([
      expect.objectContaining({
        status: 'failed',
        reason: 'invalid_contribution',
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'audit-workflow',
        eventName: 'plugin:acme.plugin:audit-workflow',
        topic: 'plugin:acme.plugin:audit-workflow',
      }),
    ]);
  });

  it('removes stale subscriptions when a hook contribution changes events', async () => {
    const originalEntry = createProjectionEntry(
      createWorkflowHookContribution({ events: ['workflow.run.completed'] }),
    );
    const changedEntry = createProjectionEntry(
      createWorkflowHookContribution({ events: ['workflow.run.failed'] }),
    );
    const contributionRegistry = {
      listActiveContributionProjectionEntries: vi
        .fn()
        .mockResolvedValueOnce([originalEntry])
        .mockResolvedValueOnce([changedEntry]),
      calculateCleanupProjectionCandidates: vi.fn().mockResolvedValue([]),
    } as unknown as PluginContributionRegistryService;
    const service = new PluginWorkflowHookProjectionService(
      contributionRegistry,
      createRuntimeManager(),
    );

    await service.projectEnabledWorkflowHooks();
    await service.projectEnabledWorkflowHooks();

    expect(service.listHookSubscriptions()).toEqual([
      expect.objectContaining({ eventName: 'workflow.run.failed' }),
    ]);
  });

  it('removes stale subscriptions when a hook contribution becomes invalid', async () => {
    const contributionRegistry = {
      listActiveContributionProjectionEntries: vi
        .fn()
        .mockResolvedValueOnce([createProjectionEntry()])
        .mockResolvedValueOnce([createInvalidProjectionEntry()]),
      calculateCleanupProjectionCandidates: vi.fn().mockResolvedValue([]),
    } as unknown as PluginContributionRegistryService;
    const service = new PluginWorkflowHookProjectionService(
      contributionRegistry,
      createRuntimeManager(),
    );

    await service.projectEnabledWorkflowHooks();
    const results = await service.projectEnabledWorkflowHooks();

    expect(results).toEqual([
      expect.objectContaining({
        status: 'failed',
        reason: 'invalid_contribution',
      }),
    ]);
    expect(service.listHookSubscriptions()).toEqual([]);
  });

  it('prunes subscriptions for plugin versions missing from active projection inventory', async () => {
    const contributionRegistry = {
      listActiveContributionProjectionEntries: vi
        .fn()
        .mockResolvedValueOnce([createProjectionEntry()])
        .mockResolvedValueOnce([]),
      calculateCleanupProjectionCandidates: vi.fn().mockResolvedValue([]),
    } as unknown as PluginContributionRegistryService;
    const service = new PluginWorkflowHookProjectionService(
      contributionRegistry,
      createRuntimeManager(),
    );

    await service.projectEnabledWorkflowHooks();
    await service.projectEnabledWorkflowHooks();

    expect(service.listHookSubscriptions()).toEqual([]);
  });

  it('delivers only matching exact-match filtered subscriptions', async () => {
    const runtimeManager = createRuntimeManager();
    const service = new PluginWorkflowHookProjectionService(
      createContributionRegistry([createProjectionEntry()]),
      runtimeManager,
    );
    await service.projectEnabledWorkflowHooks();

    const skipped = await service.deliverWorkflowHook({
      eventName: 'workflow.run.completed',
      payload: { scopeId: 'scope-2', workflowRunId: 'run-1' },
      context: { scopeId: 'scope-2' },
    });
    const delivered = await service.deliverWorkflowHook({
      eventName: 'workflow.run.completed',
      payload: { workflowRunId: 'run-1' },
      context: { scopeId: 'scope-1' },
    });

    expect(skipped).toEqual([
      expect.objectContaining({ status: 'skipped', reason: 'filter_mismatch' }),
    ]);
    expect(delivered).toEqual([
      expect.objectContaining({ status: 'delivered', blocking: false }),
    ]);
    expect(runtimeManager.deliverEvent).toHaveBeenCalledTimes(1);
    expect(runtimeManager.deliverEvent).toHaveBeenCalledWith({
      pluginId: 'acme.plugin',
      version: '1.2.3',
      actorId: 'plugin-workflow-hook-bridge',
      contributionId: 'audit-workflow',
      topic: 'workflow.run.completed',
      eventName: 'workflow.run.completed',
      payload: {
        eventName: 'workflow.run.completed',
        operation: 'handle_workflow_hook',
        payload: { workflowRunId: 'run-1' },
        context: { scopeId: 'scope-1' },
      },
    });
  });

  it('treats nested object filter values as non-matching', async () => {
    const runtimeManager = createRuntimeManager();
    const service = new PluginWorkflowHookProjectionService(
      createContributionRegistry([
        createProjectionEntry(
          createWorkflowHookContribution({ filters: { labels: ['release'] } }),
        ),
      ]),
      runtimeManager,
    );
    await service.projectEnabledWorkflowHooks();

    const results = await service.deliverWorkflowHook({
      eventName: 'workflow.run.completed',
      payload: { labels: ['release'] },
      context: {},
    });

    expect(results).toEqual([
      expect.objectContaining({ status: 'skipped', reason: 'filter_mismatch' }),
    ]);
    expect(runtimeManager.deliverEvent).not.toHaveBeenCalled();
  });

  it('allows context to satisfy a filter when payload has the same mismatched key', async () => {
    const runtimeManager = createRuntimeManager();
    const service = new PluginWorkflowHookProjectionService(
      createContributionRegistry([createProjectionEntry()]),
      runtimeManager,
    );
    await service.projectEnabledWorkflowHooks();

    const results = await service.deliverWorkflowHook({
      eventName: 'workflow.run.completed',
      payload: { scopeId: 'payload-scope' },
      context: { scopeId: 'scope-1' },
    });

    expect(results).toEqual([expect.objectContaining({ status: 'delivered' })]);
    expect(runtimeManager.deliverEvent).toHaveBeenCalledTimes(1);
  });

  it('uses context precedence when payload matches but context has the same mismatched key', async () => {
    const runtimeManager = createRuntimeManager();
    const service = new PluginWorkflowHookProjectionService(
      createContributionRegistry([createProjectionEntry()]),
      runtimeManager,
    );
    await service.projectEnabledWorkflowHooks();

    const results = await service.deliverWorkflowHook({
      eventName: 'workflow.run.completed',
      payload: { scopeId: 'scope-1' },
      context: { scopeId: 'wrong-scope' },
    });

    expect(results).toEqual([
      expect.objectContaining({ status: 'skipped', reason: 'filter_mismatch' }),
    ]);
    expect(runtimeManager.deliverEvent).not.toHaveBeenCalled();
  });

  it('falls back to payload filter matching when context lacks the key', async () => {
    const runtimeManager = createRuntimeManager();
    const service = new PluginWorkflowHookProjectionService(
      createContributionRegistry([createProjectionEntry()]),
      runtimeManager,
    );
    await service.projectEnabledWorkflowHooks();

    const results = await service.deliverWorkflowHook({
      eventName: 'workflow.run.completed',
      payload: { scopeId: 'scope-1' },
      context: {},
    });

    expect(results).toEqual([expect.objectContaining({ status: 'delivered' })]);
    expect(runtimeManager.deliverEvent).toHaveBeenCalledTimes(1);
  });

  it('returns defensive copies of subscriptions and filters', async () => {
    const service = new PluginWorkflowHookProjectionService(
      createContributionRegistry([createProjectionEntry()]),
      createRuntimeManager(),
    );
    await service.projectEnabledWorkflowHooks();

    const [subscription] = service.listHookSubscriptions() as Array<{
      filters?: Record<string, unknown>;
      operation: string;
    }>;
    subscription.operation = 'mutated_operation';
    if (subscription.filters) {
      subscription.filters.scopeId = 'mutated-scope';
    }

    expect(service.listHookSubscriptions()).toEqual([
      expect.objectContaining({
        operation: 'handle_workflow_hook',
        filters: { scopeId: 'scope-1' },
      }),
    ]);
  });

  it('reports non-blocking hook delivery failures without throwing', async () => {
    const service = new PluginWorkflowHookProjectionService(
      createContributionRegistry([createProjectionEntry()]),
      createRuntimeManager({
        ok: false,
        error: {
          code: 'runtime_error',
          message: 'secret path leaked',
          retryable: true,
        },
      }),
    );
    await service.projectEnabledWorkflowHooks();

    const results = await service.deliverWorkflowHook({
      eventName: 'workflow.run.completed',
      payload: { scopeId: 'scope-1' },
      context: {},
    });

    expect(results).toEqual([
      expect.objectContaining({
        status: 'failed',
        blocking: false,
        error: {
          code: 'plugin_workflow_hook_delivery_failed',
          message: 'Plugin workflow hook delivery failed.',
          retryable: true,
        },
      }),
    ]);
  });

  it('returns a structured blocking failure when blocking hook delivery fails', async () => {
    const service = new PluginWorkflowHookProjectionService(
      createContributionRegistry([
        createProjectionEntry(
          createWorkflowHookContribution({
            blocking: true,
            filters: undefined,
          }),
        ),
      ]),
      createRuntimeManager({
        ok: false,
        error: {
          code: 'policy_denied',
          message: 'denied by policy',
          retryable: false,
        },
      }),
    );
    await service.projectEnabledWorkflowHooks();

    const results = await service.deliverWorkflowHook({
      eventName: 'workflow.run.completed',
      payload: { scopeId: 'scope-1' },
      context: {},
    });

    expect(results).toEqual([
      expect.objectContaining({
        status: 'blocking_failed',
        blocking: true,
        error: {
          code: 'plugin_workflow_hook_delivery_failed',
          message: 'Plugin workflow hook delivery failed.',
          retryable: false,
        },
      }),
    ]);
  });

  it('cleans up subscriptions for disabled or uninstalled plugin versions', async () => {
    const entry = createProjectionEntry();
    const service = new PluginWorkflowHookProjectionService(
      createContributionRegistry([entry]),
      createRuntimeManager(),
    );
    await service.projectEnabledWorkflowHooks();

    const results = await service.cleanupPluginWorkflowHooks({
      pluginId: 'acme.plugin',
      version: '1.2.3',
    });

    expect(results).toEqual([
      {
        status: 'cleaned',
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'audit-workflow',
        eventName: 'workflow.run.completed',
        topic: 'workflow.run.completed',
      },
    ]);
    expect(service.listHookSubscriptions()).toEqual([]);
  });

  it('cleans up subscriptions when registry cleanup candidates are unavailable', async () => {
    const contributionRegistry = {
      listActiveContributionProjectionEntries: vi
        .fn()
        .mockResolvedValue([createProjectionEntry()]),
      calculateCleanupProjectionCandidates: vi.fn().mockResolvedValue([]),
    } as unknown as PluginContributionRegistryService;
    const service = new PluginWorkflowHookProjectionService(
      contributionRegistry,
      createRuntimeManager(),
    );
    await service.projectEnabledWorkflowHooks();

    const results = await service.cleanupPluginWorkflowHooks({
      pluginId: 'acme.plugin',
      version: '1.2.3',
    });

    expect(results).toEqual([
      {
        status: 'cleaned',
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'audit-workflow',
        eventName: 'workflow.run.completed',
        topic: 'workflow.run.completed',
      },
    ]);
    expect(service.listHookSubscriptions()).toEqual([]);
  });

  it('fails cleanup when candidate discovery fails and no direct subscriptions are available', async () => {
    const contributionRegistry = {
      listActiveContributionProjectionEntries: vi.fn().mockResolvedValue([]),
      calculateCleanupProjectionCandidates: vi
        .fn()
        .mockRejectedValue(new Error('database path /tmp/plugin-registry.db')),
    } as unknown as PluginContributionRegistryService;
    const service = new PluginWorkflowHookProjectionService(
      contributionRegistry,
      createRuntimeManager(),
    );

    await expect(
      service.cleanupPluginWorkflowHooks({
        pluginId: 'acme.plugin',
        version: '1.2.3',
      }),
    ).rejects.toThrow('database path /tmp/plugin-registry.db');
  });

  it('keeps other versions active during version-specific cleanup without candidates', async () => {
    const versionOneEntry = createProjectionEntry(undefined, {
      version: '1.0.0',
    });
    const versionTwoEntry = createProjectionEntry(undefined, {
      version: '2.0.0',
    });
    const contributionRegistry = {
      listActiveContributionProjectionEntries: vi
        .fn()
        .mockResolvedValue([versionOneEntry, versionTwoEntry]),
      calculateCleanupProjectionCandidates: vi.fn().mockResolvedValue([]),
    } as unknown as PluginContributionRegistryService;
    const service = new PluginWorkflowHookProjectionService(
      contributionRegistry,
      createRuntimeManager(),
    );
    await service.projectEnabledWorkflowHooks();

    await service.cleanupPluginWorkflowHooks({
      pluginId: 'acme.plugin',
      version: '1.0.0',
    });

    expect(service.listHookSubscriptions()).toEqual([
      expect.objectContaining({ version: '2.0.0' }),
    ]);
  });
});
