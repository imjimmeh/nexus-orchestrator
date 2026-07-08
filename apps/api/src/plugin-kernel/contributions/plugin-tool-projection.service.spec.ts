import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { IToolRegistry } from '@nexus/core';
import type { PluginContribution } from '@nexus/plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistryService } from '../../tool-registry/tool-registry.service';
import type { PluginRegistryEntry } from '../database/entities/plugin-registry-entry.entity';
import { PluginRegistryEntryRepository } from '../database/repositories/plugin-registry-entry.repository';
import { PluginContributionRegistryService } from './plugin-contribution-registry.service';
import type {
  PluginContributionCleanupCandidate,
  PluginContributionInventoryEntry,
} from './plugin-contribution.types';
import { PluginToolProjectionService } from './plugin-tool-projection.service';

type MockPluginContributionRegistryService = {
  listActiveContributions: ReturnType<typeof vi.fn>;
  listActiveContributionProjectionEntries: ReturnType<typeof vi.fn>;
  calculateCleanupCandidates: ReturnType<typeof vi.fn>;
  calculateCleanupProjectionCandidates: ReturnType<typeof vi.fn>;
};

type MockPluginRegistryEntryRepository = {
  listActiveEntries: ReturnType<typeof vi.fn>;
  listEntriesForPlugin: ReturnType<typeof vi.fn>;
};

type MockToolRegistryService = {
  upsertTool: ReturnType<typeof vi.fn>;
  deleteToolsByNamePrefix: ReturnType<typeof vi.fn>;
  deletePluginProjectionTool: ReturnType<typeof vi.fn>;
};

const toolInputSchema = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
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

const staticBridgeToolCode = `// plugin kernel bridge
export async function execute(input: unknown): Promise<unknown> {
  return input;
}
`;

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

function buildTool(overrides: Partial<IToolRegistry> = {}): IToolRegistry {
  return {
    id: 'tool-1',
    name: 'plugin:com.acme.workflow-tools:summarize',
    schema: toolInputSchema,
    typescript_code: 'export async function execute() { return {}; }',
    tier_restriction: 0,
    source: 'manual',
    runtime_owner: 'api',
    transport: 'api_callback',
    api_callback: true,
    created_at: new Date('2026-05-18T00:00:00.000Z'),
    updated_at: new Date('2026-05-18T00:00:00.000Z'),
    ...overrides,
  };
}

function buildCallbackBodyLikePiRunner(
  callback: { body_mapping?: Record<string, string> },
  toolParams: Record<string, unknown>,
): Record<string, unknown> {
  if (!callback.body_mapping) {
    return toolParams;
  }

  return Object.fromEntries(
    Object.entries(callback.body_mapping)
      .filter(([, paramKey]) => toolParams[paramKey] !== undefined)
      .map(([bodyField, paramKey]) => [bodyField, toolParams[paramKey]]),
  );
}

function buildRegistryEntry(
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
    requested_permissions: [],
    granted_permissions: [],
    scan_result: null,
    compatibility_result: null,
    contributions: [toolContribution],
    last_error: null,
    installed_at: new Date('2026-05-17T12:00:00.000Z'),
    scanned_at: new Date('2026-05-17T12:05:00.000Z'),
    enabled_at: new Date('2026-05-17T12:10:00.000Z'),
    disabled_at: null,
    quarantined_at: null,
    uninstalled_at: null,
    metadata: {},
    created_at: new Date('2026-05-17T12:00:00.000Z'),
    updated_at: new Date('2026-05-17T12:10:00.000Z'),
    ...overrides,
  };
}

describe('PluginToolProjectionService', () => {
  let service: PluginToolProjectionService;
  let contributionRegistry: MockPluginContributionRegistryService;
  let toolRegistry: MockToolRegistryService;

  beforeEach(async () => {
    contributionRegistry = {
      listActiveContributions: vi.fn(),
      listActiveContributionProjectionEntries: vi.fn(),
      calculateCleanupCandidates: vi.fn(),
      calculateCleanupProjectionCandidates: vi.fn(),
    };
    toolRegistry = {
      upsertTool: vi.fn(),
      deleteToolsByNamePrefix: vi.fn(),
      deletePluginProjectionTool: vi.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        PluginToolProjectionService,
        {
          provide: PluginContributionRegistryService,
          useValue: contributionRegistry,
        },
        { provide: ToolRegistryService, useValue: toolRegistry },
      ],
    }).compile();

    service = module.get(PluginToolProjectionService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('projects a valid tool contribution from enabled plugins into the tool registry', async () => {
    contributionRegistry.listActiveContributionProjectionEntries.mockResolvedValue(
      [buildInventoryEntry()],
    );
    toolRegistry.upsertTool.mockResolvedValue(buildTool());

    const result = await service.projectEnabledTools();

    expect(toolRegistry.upsertTool).toHaveBeenCalledWith({
      name: 'plugin:com.acme.workflow-tools:summarize',
      schema: toolInputSchema,
      typescript_code: staticBridgeToolCode,
      tier_restriction: 0,
      runtime_owner: 'api',
      transport: 'api_callback',
      api_callback: {
        method: 'POST',
        path_template:
          '/api/plugins/com.acme.workflow-tools/1.2.3/contributions/summarize/invoke',
        inject_scope_id: false,
      },
      language: 'node',
      publication_status: 'published',
    });
    expect(result).toEqual([
      {
        status: 'projected',
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        contributionId: 'summarize',
        toolName: 'plugin:com.acme.workflow-tools:summarize',
        toolId: 'tool-1',
      },
    ]);
  });

  it('omits callback body mapping so tool params are sent as the root request body', async () => {
    contributionRegistry.listActiveContributionProjectionEntries.mockResolvedValue(
      [buildInventoryEntry()],
    );
    toolRegistry.upsertTool.mockResolvedValue(buildTool());

    await service.projectEnabledTools();

    expect(toolRegistry.upsertTool).toHaveBeenCalledWith(
      expect.objectContaining({
        api_callback: expect.not.objectContaining({
          body_mapping: expect.anything(),
        }),
      }),
    );

    const projectedTool = toolRegistry.upsertTool.mock.calls[0]?.[0] as {
      api_callback: { body_mapping?: Record<string, string> };
    };
    const toolParams = { text: 'Long text', limit: 3 };

    expect(
      buildCallbackBodyLikePiRunner(projectedTool.api_callback, toolParams),
    ).toEqual(toolParams);
  });

  it('disables automatic scope id injection for plugin callback metadata', async () => {
    contributionRegistry.listActiveContributionProjectionEntries.mockResolvedValue(
      [buildInventoryEntry()],
    );
    toolRegistry.upsertTool.mockResolvedValue(buildTool());

    await service.projectEnabledTools();

    expect(toolRegistry.upsertTool).toHaveBeenCalledWith(
      expect.objectContaining({
        api_callback: expect.objectContaining({
          inject_scope_id: false,
        }),
      }),
    );
  });

  it('uses static bridge code without interpolating untrusted plugin tool names', async () => {
    const injectedContributionId = 'summarize\nexport const injected = true;';
    const injectedToolName = `plugin:com.acme.workflow-tools:${injectedContributionId}`;
    contributionRegistry.listActiveContributionProjectionEntries.mockResolvedValue(
      [
        buildInventoryEntry({
          contributionId: injectedContributionId,
          contribution: {
            ...toolContribution,
            id: injectedContributionId,
          },
          globalCapabilityName: injectedToolName,
          runtimeTarget: {
            pluginId: 'com.acme.workflow-tools',
            version: '1.2.3',
            contributionId: injectedContributionId,
            operation: 'execute',
          },
        }),
      ],
    );
    toolRegistry.upsertTool.mockResolvedValue(buildTool());

    await service.projectEnabledTools();

    expect(toolRegistry.upsertTool).toHaveBeenCalledWith(
      expect.objectContaining({
        typescript_code: staticBridgeToolCode,
      }),
    );
    expect(toolRegistry.upsertTool).toHaveBeenCalledWith(
      expect.objectContaining({
        typescript_code: expect.not.stringContaining('injected'),
      }),
    );
    expect(toolRegistry.upsertTool).toHaveBeenCalledWith(
      expect.objectContaining({
        typescript_code: expect.not.stringContaining(injectedToolName),
      }),
    );
  });

  it('encodes plugin callback path segments for schema-valid ids with slashes and spaces', async () => {
    contributionRegistry.listActiveContributionProjectionEntries.mockResolvedValue(
      [
        buildInventoryEntry({
          pluginId: 'com.acme/plugin tools',
          version: '1.2/with space',
          contributionId: 'summarize report',
          globalCapabilityName: 'plugin:com.acme/plugin tools:summarize report',
          runtimeTarget: {
            pluginId: 'com.acme/plugin tools',
            version: '1.2/with space',
            contributionId: 'summarize report',
            operation: 'execute',
          },
          contribution: {
            ...toolContribution,
            id: 'summarize report',
          },
        }),
      ],
    );
    toolRegistry.upsertTool.mockResolvedValue(buildTool());

    await service.projectEnabledTools();

    expect(toolRegistry.upsertTool).toHaveBeenCalledWith(
      expect.objectContaining({
        api_callback: expect.objectContaining({
          path_template:
            '/api/plugins/com.acme%2Fplugin%20tools/1.2%2Fwith%20space/contributions/summarize%20report/invoke',
        }),
      }),
    );
  });

  it('skips non-tool contributions without writing tool projections', async () => {
    contributionRegistry.listActiveContributionProjectionEntries.mockResolvedValue(
      [
        buildInventoryEntry({
          contributionId: 'summarize-step',
          type: 'workflow.step',
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
          globalCapabilityName: 'plugin:com.acme.workflow-tools:summarize-step',
        }),
      ],
    );

    const result = await service.projectEnabledTools();

    expect(toolRegistry.upsertTool).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        status: 'skipped',
        reason: 'not_tool',
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        contributionId: 'summarize-step',
        toolName: 'plugin:com.acme.workflow-tools:summarize-step',
      },
    ]);
  });

  it('rejects invalid tool schemas from registry output without projecting runtime data', async () => {
    contributionRegistry.listActiveContributionProjectionEntries.mockResolvedValue(
      [
        buildInventoryEntry({
          contribution: {
            ...toolContribution,
            config: {
              inputSchema: 'runtime supplied schema',
              operation: 'execute',
            },
          },
        }),
      ],
    );

    const result = await service.projectEnabledTools();

    expect(toolRegistry.upsertTool).not.toHaveBeenCalled();
    expect(result).toEqual([
      expect.objectContaining({
        status: 'failed',
        reason: 'invalid_contribution',
        pluginId: 'com.acme.workflow-tools',
        contributionId: 'summarize',
      }),
    ]);
  });

  it('uses deterministic global capability names as tool names across repeated projections', async () => {
    contributionRegistry.listActiveContributionProjectionEntries.mockResolvedValue(
      [buildInventoryEntry()],
    );
    toolRegistry.upsertTool
      .mockResolvedValueOnce(buildTool({ id: 'tool-1' }))
      .mockResolvedValueOnce(buildTool({ id: 'tool-1' }));

    await service.projectEnabledTools();
    await service.projectEnabledTools();

    expect(toolRegistry.upsertTool).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: 'plugin:com.acme.workflow-tools:summarize',
      }),
    );
    expect(toolRegistry.upsertTool).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: 'plugin:com.acme.workflow-tools:summarize',
      }),
    );
  });

  it('returns conflict status when tool registry rejects a projected name conflict', async () => {
    contributionRegistry.listActiveContributionProjectionEntries.mockResolvedValue(
      [buildInventoryEntry()],
    );
    toolRegistry.upsertTool.mockRejectedValue(
      new ConflictException('Tool name is owned by another source'),
    );

    const result = await service.projectEnabledTools();

    expect(result).toEqual([
      expect.objectContaining({
        status: 'conflict',
        reason: 'tool_registry_conflict',
        pluginId: 'com.acme.workflow-tools',
        contributionId: 'summarize',
        toolName: 'plugin:com.acme.workflow-tools:summarize',
      }),
    ]);
  });

  it('cleans up exact projected tool names only when ownership metadata matches', async () => {
    const candidate: PluginContributionCleanupCandidate = {
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      contributionId: 'summarize',
      type: 'tool',
      globalCapabilityName: 'plugin:com.acme.workflow-tools:summarize',
      projectionStatus: 'pending',
    };
    contributionRegistry.calculateCleanupProjectionCandidates.mockResolvedValue(
      [buildInventoryEntry(candidate)],
    );
    toolRegistry.deletePluginProjectionTool.mockResolvedValue({
      status: 'deleted',
    });

    const result = await service.cleanupPluginTools({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
    });

    expect(
      contributionRegistry.calculateCleanupProjectionCandidates,
    ).toHaveBeenCalledWith({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
    });
    expect(toolRegistry.deleteToolsByNamePrefix).not.toHaveBeenCalled();
    expect(toolRegistry.deletePluginProjectionTool).toHaveBeenCalledWith({
      name: 'plugin:com.acme.workflow-tools:summarize',
      apiCallbackPath:
        '/api/plugins/com.acme.workflow-tools/1.2.3/contributions/summarize/invoke',
    });
    expect(result).toEqual([
      {
        status: 'projected',
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        contributionId: 'summarize',
        toolName: 'plugin:com.acme.workflow-tools:summarize',
      },
    ]);
  });

  it('does not invoke prefix cleanup that could remove dynamic MCP or ACP tools', async () => {
    contributionRegistry.calculateCleanupProjectionCandidates.mockResolvedValue(
      [
        buildInventoryEntry({
          pluginId: 'com.acme',
          version: '1.2.3',
          contributionId: 'summarize',
          globalCapabilityName: 'plugin:com.acme:summarize',
        }),
      ],
    );
    toolRegistry.deletePluginProjectionTool.mockResolvedValue({
      status: 'deleted',
    });

    await service.cleanupPluginTools({
      pluginId: 'com.acme',
      version: '1.2.3',
    });

    expect(toolRegistry.deleteToolsByNamePrefix).not.toHaveBeenCalledWith(
      'plugin:com.acme:',
    );
    expect(toolRegistry.deleteToolsByNamePrefix).not.toHaveBeenCalled();
    expect(toolRegistry.deletePluginProjectionTool).toHaveBeenCalledWith({
      name: 'plugin:com.acme:summarize',
      apiCallbackPath:
        '/api/plugins/com.acme/1.2.3/contributions/summarize/invoke',
    });
  });

  it('uses encoded callback path segments for cleanup ownership checks', async () => {
    contributionRegistry.calculateCleanupProjectionCandidates.mockResolvedValue(
      [
        buildInventoryEntry({
          pluginId: 'com.acme/plugin tools',
          version: '1.2/with space',
          contributionId: 'summarize report',
          globalCapabilityName: 'plugin:com.acme/plugin tools:summarize report',
          runtimeTarget: {
            pluginId: 'com.acme/plugin tools',
            version: '1.2/with space',
            contributionId: 'summarize report',
            operation: 'execute',
          },
        }),
      ],
    );
    toolRegistry.deletePluginProjectionTool.mockResolvedValue({
      status: 'deleted',
    });

    await service.cleanupPluginTools({
      pluginId: 'com.acme/plugin tools',
      version: '1.2/with space',
    });

    expect(toolRegistry.deletePluginProjectionTool).toHaveBeenCalledWith({
      name: 'plugin:com.acme/plugin tools:summarize report',
      apiCallbackPath:
        '/api/plugins/com.acme%2Fplugin%20tools/1.2%2Fwith%20space/contributions/summarize%20report/invoke',
    });
  });

  it('returns conflict status when cleanup finds a non-owned matching tool name', async () => {
    const candidate: PluginContributionCleanupCandidate = {
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      contributionId: 'summarize',
      type: 'tool',
      globalCapabilityName: 'plugin:com.acme.workflow-tools:summarize',
      projectionStatus: 'pending',
    };
    contributionRegistry.calculateCleanupProjectionCandidates.mockResolvedValue(
      [buildInventoryEntry(candidate)],
    );
    toolRegistry.deletePluginProjectionTool.mockResolvedValue({
      status: 'conflict',
      errorMessage: 'Tool name is owned by another source',
    });

    const result = await service.cleanupPluginTools({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
    });

    expect(result).toEqual([
      expect.objectContaining({
        status: 'conflict',
        reason: 'tool_registry_conflict',
        pluginId: 'com.acme.workflow-tools',
        contributionId: 'summarize',
      }),
    ]);
  });

  it('does not require or call plugin runtime manager code during projection', async () => {
    contributionRegistry.listActiveContributionProjectionEntries.mockResolvedValue(
      [buildInventoryEntry()],
    );
    toolRegistry.upsertTool.mockResolvedValue(buildTool());

    await service.projectEnabledTools();

    expect(
      contributionRegistry.listActiveContributionProjectionEntries,
    ).toHaveBeenCalledTimes(1);
    expect(toolRegistry.upsertTool).toHaveBeenCalledTimes(1);
  });
});

describe('PluginToolProjectionService with real contribution registry', () => {
  let service: PluginToolProjectionService;
  let registryEntries: MockPluginRegistryEntryRepository;
  let toolRegistry: MockToolRegistryService;

  beforeEach(async () => {
    registryEntries = {
      listActiveEntries: vi.fn(),
      listEntriesForPlugin: vi.fn(),
    };
    toolRegistry = {
      upsertTool: vi.fn(),
      deleteToolsByNamePrefix: vi.fn(),
      deletePluginProjectionTool: vi.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        PluginToolProjectionService,
        PluginContributionRegistryService,
        { provide: PluginRegistryEntryRepository, useValue: registryEntries },
        { provide: ToolRegistryService, useValue: toolRegistry },
      ],
    }).compile();

    service = module.get(PluginToolProjectionService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns failed status for invalid stored contributions without losing valid projections', async () => {
    registryEntries.listActiveEntries.mockResolvedValue([
      buildRegistryEntry({
        contributions: [
          {
            id: 'broken',
            type: 'tool',
            displayName: 'Broken Tool',
            config: {},
          },
          toolContribution,
        ],
      }),
    ]);
    toolRegistry.upsertTool.mockResolvedValue(buildTool());

    const result = await service.projectEnabledTools();

    expect(result).toEqual([
      expect.objectContaining({
        status: 'failed',
        reason: 'invalid_contribution',
        pluginId: 'com.acme.workflow-tools',
        contributionId: 'broken',
        toolName: 'plugin:com.acme.workflow-tools:broken',
      }),
      expect.objectContaining({
        status: 'projected',
        pluginId: 'com.acme.workflow-tools',
        contributionId: 'summarize',
      }),
    ]);
    expect(toolRegistry.upsertTool).toHaveBeenCalledTimes(1);
  });

  it('deletes stale projections for invalid stored tool contributions without losing valid cleanup candidates', async () => {
    registryEntries.listEntriesForPlugin.mockResolvedValue([
      buildRegistryEntry({
        lifecycle_state: 'disabled',
        enabled: false,
        contributions: [
          {
            id: 'broken',
            type: 'tool',
            displayName: 'Broken Tool',
            config: {},
          },
          toolContribution,
        ],
      }),
    ]);
    toolRegistry.deletePluginProjectionTool.mockResolvedValue({
      status: 'deleted',
    });

    const result = await service.cleanupPluginTools({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
    });

    expect(result).toEqual([
      expect.objectContaining({
        status: 'projected',
        pluginId: 'com.acme.workflow-tools',
        contributionId: 'broken',
        toolName: 'plugin:com.acme.workflow-tools:broken',
      }),
      expect.objectContaining({
        status: 'projected',
        pluginId: 'com.acme.workflow-tools',
        contributionId: 'summarize',
      }),
    ]);
    expect(toolRegistry.deletePluginProjectionTool).toHaveBeenCalledWith({
      name: 'plugin:com.acme.workflow-tools:broken',
      apiCallbackPath:
        '/api/plugins/com.acme.workflow-tools/1.2.3/contributions/broken/invoke',
    });
    expect(toolRegistry.deletePluginProjectionTool).toHaveBeenCalledWith({
      name: 'plugin:com.acme.workflow-tools:summarize',
      apiCallbackPath:
        '/api/plugins/com.acme.workflow-tools/1.2.3/contributions/summarize/invoke',
    });
  });

  it('returns conflict when invalid stored tool contribution cleanup finds another owner', async () => {
    registryEntries.listEntriesForPlugin.mockResolvedValue([
      buildRegistryEntry({
        lifecycle_state: 'disabled',
        enabled: false,
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
    toolRegistry.deletePluginProjectionTool.mockResolvedValue({
      status: 'conflict',
      errorMessage: 'Tool name is owned by another source',
    });

    const result = await service.cleanupPluginTools({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
    });

    expect(toolRegistry.deletePluginProjectionTool).toHaveBeenCalledWith({
      name: 'plugin:com.acme.workflow-tools:broken',
      apiCallbackPath:
        '/api/plugins/com.acme.workflow-tools/1.2.3/contributions/broken/invoke',
    });
    expect(result).toEqual([
      expect.objectContaining({
        status: 'conflict',
        reason: 'tool_registry_conflict',
        pluginId: 'com.acme.workflow-tools',
        contributionId: 'broken',
      }),
    ]);
  });
});
