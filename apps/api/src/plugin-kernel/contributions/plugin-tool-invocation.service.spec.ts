import { Test } from '@nestjs/testing';
import type { PluginContribution } from '@nexus/plugin-sdk';
import Ajv from 'ajv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginEventPublisherService } from '../events/plugin-event-publisher.service';
import { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';
import type { PluginRuntimeOperationResult } from '../runtime/plugin-runtime.types';
import { PluginContributionRegistryService } from './plugin-contribution-registry.service';
import type { PluginContributionInventoryEntry } from './plugin-contribution.types';
import { PluginToolInvocationService } from './plugin-tool-invocation.service';

type MockPluginContributionRegistryService = {
  findContribution: ReturnType<typeof vi.fn>;
  findContributionByVersion: ReturnType<typeof vi.fn>;
  findContributionByGlobalCapabilityName: ReturnType<typeof vi.fn>;
  findContributionsByGlobalCapabilityName: ReturnType<typeof vi.fn>;
};

type MockPluginRuntimeManagerService = {
  invokePlugin: ReturnType<typeof vi.fn>;
};

type MockPluginEventPublisherService = {
  publishToolInvokedEvent: ReturnType<typeof vi.fn>;
};

const toolInputSchema = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
};

const toolContribution: PluginContribution = {
  id: 'summarize',
  type: 'tool',
  displayName: 'Summarize',
  description: 'Summarize text',
  config: {
    inputSchema: toolInputSchema,
    operation: 'execute',
  },
};

function buildInventoryEntry(
  overrides: Partial<PluginContributionInventoryEntry> = {},
): PluginContributionInventoryEntry {
  return {
    pluginId: 'com.acme.workflow-tools',
    version: '1.2.3',
    contributionId: 'summarize',
    type: 'tool',
    displayName: 'Summarize',
    contribution: toolContribution,
    runtimeTarget: {
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      contributionId: 'summarize',
      operation: 'execute',
    },
    isolationMode: 'worker_process',
    permissions: [],
    projectionStatus: 'pending',
    lastValidationResult: { status: 'valid' },
    globalCapabilityName: 'plugin:com.acme.workflow-tools:summarize',
    ...overrides,
  };
}

describe('PluginToolInvocationService', () => {
  let service: PluginToolInvocationService;
  let contributionRegistry: MockPluginContributionRegistryService;
  let runtimeManager: MockPluginRuntimeManagerService;
  let pluginEventPublisher: MockPluginEventPublisherService;

  beforeEach(async () => {
    contributionRegistry = {
      findContribution: vi.fn(),
      findContributionByVersion: vi.fn(),
      findContributionByGlobalCapabilityName: vi.fn(),
      findContributionsByGlobalCapabilityName: vi.fn(),
    };
    runtimeManager = {
      invokePlugin: vi.fn(),
    };
    pluginEventPublisher = {
      publishToolInvokedEvent: vi.fn().mockResolvedValue({
        ok: true,
        topic: 'tool.invoked.v1',
        deliveries: [],
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        PluginToolInvocationService,
        {
          provide: PluginContributionRegistryService,
          useValue: contributionRegistry,
        },
        { provide: PluginRuntimeManagerService, useValue: runtimeManager },
        {
          provide: PluginEventPublisherService,
          useValue: pluginEventPublisher,
        },
      ],
    }).compile();

    service = module.get(PluginToolInvocationService);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('resolves a projected tool name and invokes the plugin runtime', async () => {
    contributionRegistry.findContributionsByGlobalCapabilityName.mockResolvedValue(
      [buildInventoryEntry()],
    );
    runtimeManager.invokePlugin.mockResolvedValue({
      ok: true,
      output: { summary: 'Short text' },
    } satisfies PluginRuntimeOperationResult);

    const result = await service.invokeByToolName(
      'plugin:com.acme.workflow-tools:summarize',
      { text: 'Long text' },
    );

    expect(
      contributionRegistry.findContributionsByGlobalCapabilityName,
    ).toHaveBeenCalledWith(
      'plugin:com.acme.workflow-tools:summarize',
      undefined,
    );
    expect(runtimeManager.invokePlugin).toHaveBeenCalledWith({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      contributionId: 'summarize',
      operation: 'execute',
      input: { text: 'Long text' },
      actorId: 'plugin-tool-bridge',
    });
    expect(pluginEventPublisher.publishToolInvokedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'plugin:com.acme.workflow-tools:summarize',
        pluginId: 'com.acme.workflow-tools',
        contributionId: 'summarize',
        version: '1.2.3',
      }),
    );
    expect(result).toEqual({ ok: true, output: { summary: 'Short text' } });
  });

  it('validates tool input against the contribution input schema before runtime invocation', async () => {
    contributionRegistry.findContributionByVersion.mockResolvedValue(
      buildInventoryEntry(),
    );

    const result = await service.invokeByContribution({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      contributionId: 'summarize',
      input: { text: 42 },
    });

    expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    expect(pluginEventPublisher.publishToolInvokedEvent).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid_tool_input',
        message: 'Tool input did not match plugin contribution schema.',
        retryable: false,
      },
    });
  });

  it('rejects async schema validation results before runtime invocation', async () => {
    const compileSpy = vi
      .spyOn(Ajv.prototype, 'compile')
      .mockReturnValue(
        vi.fn().mockReturnValue(Promise.resolve(false)) as never,
      );
    contributionRegistry.findContributionByVersion.mockResolvedValue(
      buildInventoryEntry(),
    );

    const result = await service.invokeByContribution({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      contributionId: 'summarize',
      input: { text: 'Long text' },
    });

    expect(compileSpy).toHaveBeenCalledWith(toolInputSchema);
    expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid_tool_input',
        message: 'Tool input did not match plugin contribution schema.',
        retryable: false,
      },
    });
  });

  it('returns a safe structured error when the contribution is missing or inactive', async () => {
    contributionRegistry.findContributionsByGlobalCapabilityName.mockResolvedValue(
      [],
    );

    const result = await service.invokeByToolName(
      'plugin:com.acme.workflow-tools:summarize',
      { text: 'Long text' },
    );

    expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'plugin_tool_unavailable',
        message: 'Plugin tool is unavailable.',
        retryable: false,
      },
    });
  });

  it('returns a safe structured error when projected tool registry resolution fails', async () => {
    contributionRegistry.findContributionsByGlobalCapabilityName.mockRejectedValue(
      new Error('duplicate contribution contains secret details'),
    );

    const result = await service.invokeByToolName(
      'plugin:com.acme.workflow-tools:summarize',
      { text: 'Long text' },
    );

    expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'plugin_tool_unavailable',
        message: 'Plugin tool is unavailable.',
        retryable: false,
      },
    });
  });

  it('returns a safe structured error when projected tool name resolution is ambiguous without a version', async () => {
    contributionRegistry.findContributionsByGlobalCapabilityName.mockResolvedValue(
      [
        buildInventoryEntry({ version: '1.0.0' }),
        buildInventoryEntry({ version: '2.0.0' }),
      ],
    );

    const result = await service.invokeByToolName(
      'plugin:com.acme.workflow-tools:summarize',
      { text: 'Long text' },
    );

    expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'plugin_tool_ambiguous',
        message: 'Plugin tool version is ambiguous.',
        retryable: false,
      },
    });
  });

  it('uses the supplied version when projected tool name matches multiple active versions', async () => {
    contributionRegistry.findContributionsByGlobalCapabilityName.mockResolvedValue(
      [buildInventoryEntry({ version: '2.0.0' })],
    );
    runtimeManager.invokePlugin.mockResolvedValue({
      ok: true,
      output: { summary: 'Short text v2' },
    } satisfies PluginRuntimeOperationResult);

    await service.invokeByToolName(
      'plugin:com.acme.workflow-tools:summarize',
      { text: 'Long text' },
      { version: '2.0.0' },
    );

    expect(
      contributionRegistry.findContributionsByGlobalCapabilityName,
    ).toHaveBeenCalledWith('plugin:com.acme.workflow-tools:summarize', '2.0.0');
    expect(runtimeManager.invokePlugin).toHaveBeenCalledWith(
      expect.objectContaining({ version: '2.0.0' }),
    );
  });

  it('returns a safe structured error for disabled or quarantined entries resolved by the registry', async () => {
    contributionRegistry.findContributionByVersion.mockResolvedValue(
      buildInventoryEntry({
        lastValidationResult: {
          status: 'invalid',
          errorMessage: 'Plugin is quarantined because scan failed',
        },
      } as unknown as Partial<PluginContributionInventoryEntry>),
    );

    const result = await service.invokeByContribution({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      contributionId: 'summarize',
      input: { text: 'Long text' },
    });

    expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'plugin_tool_unavailable',
        message: 'Plugin tool is unavailable.',
        retryable: false,
      },
    });
  });

  it('returns a safe structured error when pair registry lookup fails', async () => {
    contributionRegistry.findContributionByVersion.mockRejectedValue(
      new Error('duplicate contribution contains secret details'),
    );

    const result = await service.invokeByContribution({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      contributionId: 'summarize',
      input: { text: 'Long text' },
    });

    expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'plugin_tool_unavailable',
        message: 'Plugin tool is unavailable.',
        retryable: false,
      },
    });
  });

  it('returns a safe structured error for non-tool contributions', async () => {
    contributionRegistry.findContributionByVersion.mockResolvedValue(
      buildInventoryEntry({
        type: 'workflow.step',
        contributionId: 'summarize-step',
        contribution: {
          id: 'summarize-step',
          type: 'workflow.step',
          displayName: 'Summarize Step',
          config: {
            stepType: 'acme.summarize',
            inputContract: { type: 'object' },
            operation: 'execute',
          },
        },
      }),
    );

    const result = await service.invokeByContribution({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      contributionId: 'summarize-step',
      input: { text: 'Long text' },
    });

    expect(runtimeManager.invokePlugin).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'not_plugin_tool',
        message: 'Plugin contribution is not a tool.',
        retryable: false,
      },
    });
  });

  it('normalizes runtime failures without leaking raw plugin error details', async () => {
    contributionRegistry.findContributionByVersion.mockResolvedValue(
      buildInventoryEntry(),
    );
    runtimeManager.invokePlugin.mockResolvedValue({
      ok: false,
      error: {
        code: 'runtime_error',
        message: 'stack trace: secret token abc123',
        retryable: true,
        details: { secret: 'abc123' },
      },
    } satisfies PluginRuntimeOperationResult);

    const result = await service.invokeByContribution({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      contributionId: 'summarize',
      input: { text: 'Long text' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'plugin_tool_runtime_failed',
        message: 'Plugin tool invocation failed.',
        retryable: true,
      },
    });
  });

  it('uses a safe contribution operation name when one is configured', async () => {
    contributionRegistry.findContributionByVersion.mockResolvedValue(
      buildInventoryEntry({
        contribution: {
          ...toolContribution,
          config: {
            ...toolContribution.config,
            operation: 'summarize_text',
          },
        },
        runtimeTarget: {
          pluginId: 'com.acme.workflow-tools',
          version: '1.2.3',
          contributionId: 'summarize',
          operation: 'summarize_text',
        },
      }),
    );
    runtimeManager.invokePlugin.mockResolvedValue({
      ok: true,
      output: { summary: 'Short text' },
    } satisfies PluginRuntimeOperationResult);

    await service.invokeByContribution({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      contributionId: 'summarize',
      input: { text: 'Long text' },
      actorId: 'workflow-run-1',
    });

    expect(runtimeManager.invokePlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'summarize_text',
        actorId: 'workflow-run-1',
      }),
    );
  });

  it('falls back to execute when the configured operation name is unsafe', async () => {
    contributionRegistry.findContributionByVersion.mockResolvedValue(
      buildInventoryEntry({
        contribution: {
          ...toolContribution,
          config: {
            ...toolContribution.config,
            operation: ' unsafe operation ',
          },
        },
        runtimeTarget: {
          pluginId: 'com.acme.workflow-tools',
          version: '1.2.3',
          contributionId: 'summarize',
          operation: ' unsafe operation ',
        },
      }),
    );
    runtimeManager.invokePlugin.mockResolvedValue({
      ok: true,
      output: { summary: 'Short text' },
    } satisfies PluginRuntimeOperationResult);

    await service.invokeByContribution({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      contributionId: 'summarize',
      input: { text: 'Long text' },
    });

    expect(runtimeManager.invokePlugin).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'execute' }),
    );
  });

  it('uses the requested version when multiple enabled versions share a contribution id', async () => {
    contributionRegistry.findContribution.mockResolvedValue(
      buildInventoryEntry({ version: '1.0.0' }),
    );
    contributionRegistry.findContributionByVersion.mockResolvedValue(
      buildInventoryEntry({
        version: '2.0.0',
        runtimeTarget: {
          pluginId: 'com.acme.workflow-tools',
          version: '2.0.0',
          contributionId: 'summarize',
          operation: 'execute',
        },
      }),
    );
    runtimeManager.invokePlugin.mockResolvedValue({
      ok: true,
      output: { summary: 'Short text v2' },
    } satisfies PluginRuntimeOperationResult);

    await service.invokeByContribution({
      pluginId: 'com.acme.workflow-tools',
      version: '2.0.0',
      contributionId: 'summarize',
      input: { text: 'Long text' },
    });

    expect(contributionRegistry.findContributionByVersion).toHaveBeenCalledWith(
      'com.acme.workflow-tools',
      '2.0.0',
      'summarize',
    );
    expect(runtimeManager.invokePlugin).toHaveBeenCalledWith(
      expect.objectContaining({ version: '2.0.0' }),
    );
  });

  it('resolves exact projected tool names when contribution ids contain colons', async () => {
    contributionRegistry.findContributionsByGlobalCapabilityName.mockResolvedValue(
      [
        buildInventoryEntry({
          contributionId: 'summarize:deep',
          contribution: { ...toolContribution, id: 'summarize:deep' },
          globalCapabilityName: 'plugin:com.acme.workflow-tools:summarize:deep',
          runtimeTarget: {
            pluginId: 'com.acme.workflow-tools',
            version: '1.2.3',
            contributionId: 'summarize:deep',
            operation: 'execute',
          },
        }),
      ],
    );
    runtimeManager.invokePlugin.mockResolvedValue({
      ok: true,
      output: { summary: 'Deep summary' },
    } satisfies PluginRuntimeOperationResult);

    await service.invokeByToolName(
      'plugin:com.acme.workflow-tools:summarize:deep',
      { text: 'Long text' },
      { version: '1.2.3' },
    );

    expect(
      contributionRegistry.findContributionsByGlobalCapabilityName,
    ).toHaveBeenCalledWith(
      'plugin:com.acme.workflow-tools:summarize:deep',
      '1.2.3',
    );
    expect(runtimeManager.invokePlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        contributionId: 'summarize:deep',
      }),
    );
  });
});
