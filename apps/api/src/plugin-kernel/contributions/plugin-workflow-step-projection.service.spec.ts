import { describe, expect, it, vi } from 'vitest';
import type { WorkflowStepContribution } from '@nexus/plugin-sdk';
import { StepSpecialStepRegistryService } from '../../workflow/workflow-special-steps/step-special-step-registry.service';
import {
  CORE_SPECIAL_STEP_TYPES,
  type ISpecialStepHandler,
} from '../../workflow/workflow-special-steps/step-special-step.types';
import type { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';
import type { PluginContributionRegistryService } from './plugin-contribution-registry.service';
import type {
  PluginContributionInventoryEntry,
  PluginContributionProjectionInventoryEntry,
} from './plugin-contribution.types';
import { PluginWorkflowStepProjectionService } from './plugin-workflow-step-projection.service';

type WorkflowStepRegistryDouble = StepSpecialStepRegistryService & {
  registerPluginHandler: ReturnType<typeof vi.fn>;
  unregisterPluginHandler: ReturnType<typeof vi.fn>;
};

function createWorkflowStepContribution(
  config: Partial<WorkflowStepContribution['config']> = {},
): WorkflowStepContribution {
  return {
    id: 'summarize',
    type: 'workflow.step',
    displayName: 'Summarize text',
    config: {
      stepType: 'plugin:acme.plugin:summarize',
      inputContract: 'acme.summarize.inputs',
      operation: 'summarize_text',
      ...config,
    },
  };
}

function createProjectionEntry(
  contribution: WorkflowStepContribution = createWorkflowStepContribution(),
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
    globalCapabilityName: 'plugin:acme.plugin:summarize',
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

function createSpecialStepRegistry(): WorkflowStepRegistryDouble {
  const handlers = new Map<
    string,
    { type: string; descriptor: Record<string, unknown> }
  >();
  return {
    getHandler: vi.fn((stepType: string) => handlers.get(stepType) ?? null),
    registerPluginHandler: vi.fn(
      (handler: { type: string; descriptor: Record<string, unknown> }) => {
        handlers.set(handler.type, handler);
      },
    ),
    unregisterPluginHandler: vi.fn((stepType: string) =>
      handlers.delete(stepType),
    ),
  } as unknown as WorkflowStepRegistryDouble;
}

function createRuntimeManager(): PluginRuntimeManagerService {
  return {
    invokePlugin: vi.fn(),
  } as unknown as PluginRuntimeManagerService;
}

function createCoreSpecialStepHandler(type: string): ISpecialStepHandler {
  return {
    type,
    descriptor: {
      type,
      owningDomain: 'core',
      inputContract: `${type}.inputs`,
    },
    execute: () =>
      Promise.resolve({
        result: {
          status: 'completed',
          mode: 'emit_event',
          eventName: 'noop',
        },
        output: { ok: true },
      }),
  };
}

function createRealSpecialStepRegistry(): StepSpecialStepRegistryService {
  const registry = new StepSpecialStepRegistryService(
    CORE_SPECIAL_STEP_TYPES.map((type) => createCoreSpecialStepHandler(type)),
  );
  registry.onModuleInit();
  return registry;
}

describe('PluginWorkflowStepProjectionService', () => {
  it('registers generated workflow step handlers for valid contributions', async () => {
    const entry = createProjectionEntry();
    const specialStepRegistry = createSpecialStepRegistry();
    const service = new PluginWorkflowStepProjectionService(
      createContributionRegistry([entry]),
      specialStepRegistry,
      createRuntimeManager(),
    );

    const results = await service.projectEnabledWorkflowSteps();

    expect(results).toEqual([
      {
        status: 'projected',
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
        stepType: 'plugin:acme.plugin:summarize',
      },
    ]);
    expect(specialStepRegistry.registerPluginHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'plugin:acme.plugin:summarize',
        descriptor: expect.objectContaining({
          owningDomain: 'plugin',
          pluginId: 'acme.plugin',
        }),
      }),
    );
  });

  it('rejects workflow step contributions that shadow core special-step types', async () => {
    const entry = createProjectionEntry(
      createWorkflowStepContribution({ stepType: 'run_command' }),
    );
    const service = new PluginWorkflowStepProjectionService(
      createContributionRegistry([entry]),
      createSpecialStepRegistry(),
      createRuntimeManager(),
    );

    await expect(service.projectEnabledWorkflowSteps()).resolves.toEqual([
      {
        status: 'conflict',
        reason: 'reserved_or_core_step_type',
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
        stepType: 'run_command',
      },
    ]);
  });

  it('rejects workflow step contributions that use reserved special-step types', async () => {
    const entry = createProjectionEntry(
      createWorkflowStepContribution({ stepType: 'execution' }),
    );
    const specialStepRegistry = createSpecialStepRegistry();
    const service = new PluginWorkflowStepProjectionService(
      createContributionRegistry([entry]),
      specialStepRegistry,
      createRuntimeManager(),
    );

    await expect(service.projectEnabledWorkflowSteps()).resolves.toEqual([
      {
        status: 'conflict',
        reason: 'reserved_or_core_step_type',
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
        stepType: 'execution',
      },
    ]);
    expect(specialStepRegistry.registerPluginHandler).not.toHaveBeenCalled();
  });

  it('does not register duplicate handlers for the same plugin version', async () => {
    const entry = createProjectionEntry();
    const specialStepRegistry = createSpecialStepRegistry();
    const service = new PluginWorkflowStepProjectionService(
      createContributionRegistry([entry]),
      specialStepRegistry,
      createRuntimeManager(),
    );

    await service.projectEnabledWorkflowSteps();
    const secondResult = await service.projectEnabledWorkflowSteps();

    expect(secondResult).toEqual([
      {
        status: 'projected',
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
        stepType: 'plugin:acme.plugin:summarize',
      },
    ]);
    expect(specialStepRegistry.registerPluginHandler).toHaveBeenCalledTimes(1);
  });

  it('treats an existing matching registry handler as projected for a fresh service instance', async () => {
    const entry = createProjectionEntry();
    const specialStepRegistry = createSpecialStepRegistry();
    specialStepRegistry.getHandler = vi.fn().mockReturnValue({
      type: 'plugin:acme.plugin:summarize',
      descriptor: {
        type: 'plugin:acme.plugin:summarize',
        owningDomain: 'plugin',
        pluginId: 'acme.plugin',
        pluginVersion: '1.2.3',
        contributionId: 'summarize',
        inputContract: 'acme.summarize.inputs',
      },
    });
    specialStepRegistry.registerPluginHandler.mockImplementation(() => {
      throw new Error('duplicate plugin handler');
    });
    const service = new PluginWorkflowStepProjectionService(
      createContributionRegistry([entry]),
      specialStepRegistry,
      createRuntimeManager(),
    );

    const results = await service.projectEnabledWorkflowSteps();

    expect(results).toEqual([
      {
        status: 'projected',
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
        stepType: 'plugin:acme.plugin:summarize',
      },
    ]);
    expect(specialStepRegistry.registerPluginHandler).not.toHaveBeenCalled();
  });

  it('re-registers a projected handler when the registry no longer has it', async () => {
    const entry = createProjectionEntry();
    const specialStepRegistry = createSpecialStepRegistry();
    specialStepRegistry.getHandler = vi
      .fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null);
    const service = new PluginWorkflowStepProjectionService(
      createContributionRegistry([entry]),
      specialStepRegistry,
      createRuntimeManager(),
    );

    await service.projectEnabledWorkflowSteps();
    const secondResult = await service.projectEnabledWorkflowSteps();

    expect(secondResult).toEqual([
      {
        status: 'projected',
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
        stepType: 'plugin:acme.plugin:summarize',
      },
    ]);
    expect(specialStepRegistry.registerPluginHandler).toHaveBeenCalledTimes(2);
  });

  it('does not clean up an active handler for another plugin version sharing the step type', async () => {
    const contribution = createWorkflowStepContribution({
      stepType: 'plugin:acme.plugin:shared_step',
    });
    const activeEntry = createProjectionEntry(contribution, {
      version: '2.0.0',
      runtimeTarget: {
        pluginId: 'acme.plugin',
        version: '2.0.0',
        contributionId: 'summarize',
        operation: 'summarize_text',
      },
      globalCapabilityName: 'plugin:acme.plugin:shared_step',
    });
    const cleanupEntry = createProjectionEntry(contribution, {
      version: '1.0.0',
      runtimeTarget: {
        pluginId: 'acme.plugin',
        version: '1.0.0',
        contributionId: 'summarize',
        operation: 'summarize_text',
      },
      globalCapabilityName: 'plugin:acme.plugin:shared_step',
    });
    const contributionRegistry = {
      listActiveContributionProjectionEntries: vi
        .fn()
        .mockResolvedValue([activeEntry]),
      calculateCleanupProjectionCandidates: vi
        .fn()
        .mockResolvedValue([cleanupEntry]),
    } as unknown as PluginContributionRegistryService;
    const specialStepRegistry = createSpecialStepRegistry();
    specialStepRegistry.unregisterPluginHandler.mockReturnValue(false);
    const service = new PluginWorkflowStepProjectionService(
      contributionRegistry,
      specialStepRegistry,
      createRuntimeManager(),
    );
    await service.projectEnabledWorkflowSteps();

    const cleanupResults = await service.cleanupPluginWorkflowSteps({
      pluginId: 'acme.plugin',
      version: '1.0.0',
    });
    await service.projectEnabledWorkflowSteps();

    expect(cleanupResults).toEqual([
      {
        status: 'skipped',
        reason: 'not_found',
        pluginId: 'acme.plugin',
        version: '1.0.0',
        contributionId: 'summarize',
        stepType: 'plugin:acme.plugin:shared_step',
      },
    ]);
    expect(specialStepRegistry.registerPluginHandler).toHaveBeenCalledTimes(1);
  });

  it('cleans up projected handlers for disabled or uninstalled plugin versions', async () => {
    const entry = createProjectionEntry();
    const specialStepRegistry = createSpecialStepRegistry();
    const service = new PluginWorkflowStepProjectionService(
      createContributionRegistry([entry]),
      specialStepRegistry,
      createRuntimeManager(),
    );
    await service.projectEnabledWorkflowSteps();

    const results = await service.cleanupPluginWorkflowSteps({
      pluginId: 'acme.plugin',
      version: '1.2.3',
    });

    expect(results).toEqual([
      {
        status: 'cleaned',
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
        stepType: 'plugin:acme.plugin:summarize',
      },
    ]);
    expect(specialStepRegistry.unregisterPluginHandler).toHaveBeenCalledWith(
      'plugin:acme.plugin:summarize',
      {
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
      },
    );
  });

  it('does not clean up a real registered handler owned by another plugin', async () => {
    const contribution = createWorkflowStepContribution({
      stepType: 'plugin:shared.plugin:summarize',
    });
    const activeEntry = createProjectionEntry(contribution, {
      pluginId: 'acme.plugin',
      globalCapabilityName: 'plugin:shared.plugin:summarize',
    });
    const cleanupCandidate = createProjectionEntry(contribution, {
      pluginId: 'other.plugin',
      globalCapabilityName: 'plugin:shared.plugin:summarize',
      runtimeTarget: {
        pluginId: 'other.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
        operation: 'summarize_text',
      },
    });
    const contributionRegistry = {
      listActiveContributionProjectionEntries: vi
        .fn()
        .mockResolvedValue([activeEntry]),
      calculateCleanupProjectionCandidates: vi
        .fn()
        .mockResolvedValue([cleanupCandidate]),
    } as unknown as PluginContributionRegistryService;
    const specialStepRegistry = createRealSpecialStepRegistry();
    const service = new PluginWorkflowStepProjectionService(
      contributionRegistry,
      specialStepRegistry,
      createRuntimeManager(),
    );
    await service.projectEnabledWorkflowSteps();
    const activeHandler = specialStepRegistry.getHandler(
      'plugin:shared.plugin:summarize',
    );

    const results = await service.cleanupPluginWorkflowSteps({
      pluginId: 'other.plugin',
      version: '1.2.3',
    });

    expect(results).toEqual([
      {
        status: 'skipped',
        reason: 'not_found',
        pluginId: 'other.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
        stepType: 'plugin:shared.plugin:summarize',
      },
    ]);
    expect(activeHandler?.descriptor.pluginId).toBe('acme.plugin');
    expect(
      specialStepRegistry.getHandler('plugin:shared.plugin:summarize'),
    ).toBe(activeHandler);
  });
});
