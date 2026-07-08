import { describe, expect, it, vi } from 'vitest';
import type { PluginEventSubscriptionProjectionService } from '../events/plugin-event-subscription-projection.service';
import type { PluginToolProjectionService } from './plugin-tool-projection.service';
import type { PluginWorkflowHookProjectionService } from './plugin-workflow-hook-projection.service';
import { PluginProjectionOrchestratorService } from './plugin-projection-orchestrator.service';
import type { PluginWorkflowStepProjectionService } from './plugin-workflow-step-projection.service';

type MockPluginToolProjectionService = {
  projectEnabledTools: ReturnType<typeof vi.fn>;
  cleanupPluginTools: ReturnType<typeof vi.fn>;
};

type MockPluginWorkflowStepProjectionService = {
  projectEnabledWorkflowSteps: ReturnType<typeof vi.fn>;
  cleanupPluginWorkflowSteps: ReturnType<typeof vi.fn>;
};

type MockPluginWorkflowHookProjectionService = {
  projectEnabledWorkflowHooks: ReturnType<typeof vi.fn>;
  cleanupPluginWorkflowHooks: ReturnType<typeof vi.fn>;
};

type MockPluginEventSubscriptionProjectionService = {
  projectEnabledEventSubscriptions: ReturnType<typeof vi.fn>;
  cleanupPluginEventSubscriptions: ReturnType<typeof vi.fn>;
};

function createService(
  overrides: {
    tools?: Partial<MockPluginToolProjectionService>;
    workflowSteps?: Partial<MockPluginWorkflowStepProjectionService>;
    workflowHooks?: Partial<MockPluginWorkflowHookProjectionService>;
    eventSubscriptions?: Partial<MockPluginEventSubscriptionProjectionService>;
  } = {},
) {
  const tools = {
    projectEnabledTools: vi.fn().mockResolvedValue([]),
    cleanupPluginTools: vi.fn().mockResolvedValue([]),
    ...overrides.tools,
  };
  const workflowSteps = {
    projectEnabledWorkflowSteps: vi.fn().mockResolvedValue([]),
    cleanupPluginWorkflowSteps: vi.fn().mockResolvedValue([]),
    ...overrides.workflowSteps,
  };
  const workflowHooks = {
    projectEnabledWorkflowHooks: vi.fn().mockResolvedValue([]),
    cleanupPluginWorkflowHooks: vi.fn().mockResolvedValue([]),
    ...overrides.workflowHooks,
  };
  const eventSubscriptions = {
    projectEnabledEventSubscriptions: vi.fn().mockResolvedValue([]),
    cleanupPluginEventSubscriptions: vi.fn().mockResolvedValue([]),
    ...overrides.eventSubscriptions,
  };

  return {
    service: new PluginProjectionOrchestratorService(
      tools as unknown as PluginToolProjectionService,
      workflowSteps as unknown as PluginWorkflowStepProjectionService,
      workflowHooks as unknown as PluginWorkflowHookProjectionService,
      eventSubscriptions as unknown as PluginEventSubscriptionProjectionService,
    ),
    tools,
    workflowSteps,
    workflowHooks,
    eventSubscriptions,
  };
}

describe('PluginProjectionOrchestratorService', () => {
  it('refreshes projected inventory across every projection adapter', async () => {
    const { service, tools, workflowSteps, workflowHooks, eventSubscriptions } =
      createService({
        tools: {
          projectEnabledTools: vi.fn().mockResolvedValue([
            {
              status: 'projected',
              pluginId: 'acme.plugin',
              version: '1.0.0',
              contributionId: 'summarize',
              toolName: 'plugin:acme.plugin:summarize',
            },
          ]),
        },
        workflowSteps: {
          projectEnabledWorkflowSteps: vi.fn().mockResolvedValue([
            {
              status: 'projected',
              pluginId: 'acme.plugin',
              version: '1.0.0',
              contributionId: 'route',
              stepType: 'plugin:acme.plugin:route',
            },
          ]),
        },
        workflowHooks: {
          projectEnabledWorkflowHooks: vi.fn().mockResolvedValue([
            {
              status: 'projected',
              pluginId: 'acme.plugin',
              version: '1.0.0',
              contributionId: 'audit',
              eventName: 'workflow.run.completed',
              topic: 'workflow.run.completed',
            },
          ]),
        },
        eventSubscriptions: {
          projectEnabledEventSubscriptions: vi.fn().mockResolvedValue([
            {
              status: 'projected',
              pluginId: 'acme.plugin',
              version: '1.0.0',
              contributionId: 'event-subscription',
              topics: ['workflow.run.completed.v1'],
            },
          ]),
        },
      });

    const result = await service.refreshProjectedContributions();

    expect(result).toEqual({
      ok: true,
      action: 'refresh',
      results: {
        tools: [expect.objectContaining({ status: 'projected' })],
        workflowSteps: [expect.objectContaining({ status: 'projected' })],
        workflowHooks: [expect.objectContaining({ status: 'projected' })],
        eventSubscriptions: [expect.objectContaining({ status: 'projected' })],
      },
      errors: [],
    });
    expect(tools.projectEnabledTools).toHaveBeenCalledTimes(1);
    expect(workflowSteps.projectEnabledWorkflowSteps).toHaveBeenCalledTimes(1);
    expect(workflowHooks.projectEnabledWorkflowHooks).toHaveBeenCalledTimes(1);
    expect(
      eventSubscriptions.projectEnabledEventSubscriptions,
    ).toHaveBeenCalledTimes(1);
  });

  it('cleans projected contributions across every projection adapter', async () => {
    const request = { pluginId: 'acme.plugin', version: '1.0.0' };
    const { service, tools, workflowSteps, workflowHooks, eventSubscriptions } =
      createService();

    await expect(
      service.cleanupProjectedContributions(request),
    ).resolves.toEqual(
      expect.objectContaining({ ok: true, action: 'cleanup', errors: [] }),
    );
    expect(tools.cleanupPluginTools).toHaveBeenCalledWith(request);
    expect(workflowSteps.cleanupPluginWorkflowSteps).toHaveBeenCalledWith(
      request,
    );
    expect(workflowHooks.cleanupPluginWorkflowHooks).toHaveBeenCalledWith(
      request,
    );
    expect(
      eventSubscriptions.cleanupPluginEventSubscriptions,
    ).toHaveBeenCalledWith(request);
  });

  it('treats not-found cleanup results as idempotent success', async () => {
    const { service } = createService({
      tools: {
        cleanupPluginTools: vi.fn().mockResolvedValue([
          {
            status: 'skipped',
            reason: 'not_found',
            pluginId: 'acme.plugin',
            version: '1.0.0',
            contributionId: 'summarize',
            toolName: 'plugin:acme.plugin:summarize',
          },
        ]),
      },
    });

    const first = await service.cleanupProjectedContributions({
      pluginId: 'acme.plugin',
      version: '1.0.0',
    });
    const second = await service.cleanupProjectedContributions({
      pluginId: 'acme.plugin',
      version: '1.0.0',
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
  });

  it('aggregates partial adapter cleanup failures while still running remaining adapters', async () => {
    const { service, workflowSteps, workflowHooks } = createService({
      tools: {
        cleanupPluginTools: vi.fn().mockResolvedValue([
          {
            status: 'failed',
            reason: 'cleanup_error',
            errorMessage: 'raw payload /srv/plugins/acme secret=abc123',
            pluginId: 'acme.plugin',
            version: '1.0.0',
            contributionId: 'summarize',
            toolName: 'plugin:acme.plugin:summarize',
          },
        ]),
      },
      workflowSteps: {
        cleanupPluginWorkflowSteps: vi
          .fn()
          .mockRejectedValue(new Error('stack trace /tmp/runtime.sock')),
      },
      workflowHooks: {
        cleanupPluginWorkflowHooks: vi.fn().mockResolvedValue([]),
      },
    });

    const result = await service.cleanupProjectedContributions({
      pluginId: 'acme.plugin',
      version: '1.0.0',
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      {
        adapter: 'tools',
        code: 'plugin_projection_cleanup_failed',
        message: 'Plugin projection cleanup failed.',
      },
      {
        adapter: 'workflowSteps',
        code: 'plugin_projection_cleanup_failed',
        message: 'Plugin projection cleanup failed.',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('/srv/plugins/acme');
    expect(JSON.stringify(result)).not.toContain('secret=abc123');
    expect(JSON.stringify(result)).not.toContain('/tmp/runtime.sock');
    expect(workflowSteps.cleanupPluginWorkflowSteps).toHaveBeenCalledTimes(1);
    expect(workflowHooks.cleanupPluginWorkflowHooks).toHaveBeenCalledTimes(1);
  });

  it('returns a safe cleanup error when workflow hook candidate discovery fails', async () => {
    const { service } = createService({
      workflowHooks: {
        cleanupPluginWorkflowHooks: vi
          .fn()
          .mockRejectedValue(
            new Error('database path /tmp/plugin-registry.db'),
          ),
      },
    });

    const result = await service.cleanupProjectedContributions({
      pluginId: 'acme.plugin',
      version: '1.0.0',
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      {
        adapter: 'workflowHooks',
        code: 'plugin_projection_cleanup_failed',
        message: 'Plugin projection cleanup failed.',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('/tmp/plugin-registry.db');
  });

  it('returns safe refresh errors without leaking adapter runtime details', async () => {
    const { service } = createService({
      workflowHooks: {
        projectEnabledWorkflowHooks: vi
          .fn()
          .mockRejectedValue(
            new Error('payload={"token":"secret"} C:\\plugins\\acme'),
          ),
      },
    });

    const result = await service.refreshProjectedContributions();

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      {
        adapter: 'workflowHooks',
        code: 'plugin_projection_refresh_failed',
        message: 'Plugin projection refresh failed.',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('C:\\plugins\\acme');
  });
});
