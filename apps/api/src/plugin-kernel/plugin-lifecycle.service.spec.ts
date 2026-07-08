import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  PluginManifest,
  PluginManifestContribution,
  PluginPermission,
} from '@nexus/plugin-sdk';
import { DataSource, type EntityManager } from 'typeorm';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PluginRegistryEntry } from './database/entities/plugin-registry-entry.entity';
import { PluginRegistryEntryRepository } from './database/repositories/plugin-registry-entry.repository';
import { PLUGIN_PROJECTION_ORCHESTRATOR } from './contributions/plugin-projection-orchestrator.token';
import { PluginAuditService } from './plugin-audit.service';
import { PluginLifecycleStateMachineService } from './plugin-lifecycle-state-machine.service';
import { PluginLifecycleService } from './plugin-lifecycle.service';
import { PluginPolicyService } from './plugin-policy.service';

type MockPluginRegistryEntryRepository = {
  saveEntry: Mock<(...args: any[]) => Promise<any>>;
  findByPluginIdAndVersion: Mock<(...args: any[]) => Promise<any>>;
  listActiveEntries: Mock<(...args: any[]) => Promise<any>>;
  markLifecycleState: Mock<(...args: any[]) => Promise<any>>;
};

type MockPluginAuditService = {
  recordLifecycleEvent: Mock<(...args: any[]) => Promise<any>>;
};

type MockDataSource = {
  transaction: Mock<(...args: any[]) => Promise<any>>;
};

type MockPluginProjectionOrchestratorService = {
  refreshProjectedContributions: Mock<(...args: any[]) => Promise<any>>;
  cleanupProjectedContributions: Mock<(...args: any[]) => Promise<any>>;
};

const actorId = 'admin-1';

function buildManifest(
  overrides: Partial<PluginManifest> = {},
): PluginManifest {
  return {
    id: 'com.acme.workflow-tools',
    name: 'Acme Workflow Tools',
    version: '1.2.3',
    description: 'Workflow helpers',
    author: 'Acme',
    packageName: '@acme/workflow-tools',
    packageVersion: '1.2.3',
    nexusCompatibility: {
      pluginApiVersion: '1.0.0',
      minVersion: '0.1.0',
    },
    entrypoints: { main: './dist/index.js' },
    isolationModes: ['worker_process'],
    permissions: [{ kind: 'network', hosts: ['api.acme.test'] }],
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
    ...overrides,
  };
}

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
    lifecycle_state: 'installed',
    enabled: false,
    trust_level: 'third_party',
    isolation_mode: 'worker_process',
    requested_permissions: [{ kind: 'network', hosts: ['api.acme.test'] }],
    granted_permissions: [],
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
    scanned_at: null,
    enabled_at: null,
    disabled_at: null,
    quarantined_at: null,
    uninstalled_at: null,
    metadata: { package_name: '@acme/workflow-tools' },
    created_at: new Date('2026-05-17T12:00:00.000Z'),
    updated_at: new Date('2026-05-17T12:00:00.000Z'),
    ...overrides,
  };
}

describe('PluginLifecycleService', () => {
  let service: PluginLifecycleService;
  let repository: MockPluginRegistryEntryRepository;
  let audit: MockPluginAuditService;
  let dataSource: MockDataSource;
  let projectionOrchestrator: MockPluginProjectionOrchestratorService;
  let transactionManager: EntityManager;

  beforeEach(async () => {
    repository = {
      saveEntry: vi.fn(),
      findByPluginIdAndVersion: vi.fn(),
      listActiveEntries: vi.fn(),
      markLifecycleState: vi.fn(),
    };
    audit = {
      recordLifecycleEvent: vi.fn().mockResolvedValue(undefined),
    };
    transactionManager = {} as EntityManager;
    dataSource = {
      transaction: vi.fn((callback: (manager: EntityManager) => unknown) =>
        Promise.resolve(callback(transactionManager)),
      ),
    };
    projectionOrchestrator = {
      refreshProjectedContributions: vi.fn().mockResolvedValue({
        ok: true,
        action: 'refresh',
        results: { tools: [], workflowSteps: [], workflowHooks: [] },
        errors: [],
      }),
      cleanupProjectedContributions: vi.fn().mockResolvedValue({
        ok: true,
        action: 'cleanup',
        results: { tools: [], workflowSteps: [], workflowHooks: [] },
        errors: [],
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        PluginLifecycleService,
        PluginLifecycleStateMachineService,
        { provide: PluginRegistryEntryRepository, useValue: repository },
        { provide: PluginAuditService, useValue: audit },
        { provide: DataSource, useValue: dataSource },
        {
          provide: PLUGIN_PROJECTION_ORCHESTRATOR,
          useValue: projectionOrchestrator,
        },
      ],
    }).compile();

    service = module.get(PluginLifecycleService);
  });

  it('discovers package manifests without persisting registry state', () => {
    const manifest = buildManifest();

    const discovered = service.discoverPackage(manifest, {
      source: '@acme/workflow-tools',
    });

    expect(discovered.pluginId).toBe('com.acme.workflow-tools');
    expect(discovered.version).toBe('1.2.3');
    expect(discovered.manifest).toEqual(manifest);
    expect(repository.saveEntry).not.toHaveBeenCalled();
  });

  it('installs a plugin from a parsed manifest and emits audit', async () => {
    const manifest = buildManifest();
    const savedEntry = buildEntry();
    repository.findByPluginIdAndVersion.mockResolvedValue(null);
    repository.saveEntry.mockResolvedValue(savedEntry);

    const result = await service.installPlugin({
      manifest,
      source: '@acme/workflow-tools',
      actorId,
    });

    expect(result).toEqual(savedEntry);
    expect(repository.saveEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        plugin_id: 'com.acme.workflow-tools',
        version: '1.2.3',
        lifecycle_state: 'installed',
        trust_level: 'third_party',
        isolation_mode: 'worker_process',
        requested_permissions: manifest.permissions,
        contributions: manifest.contributions,
      }),
      transactionManager,
    );
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'install',
        actorId,
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        fromState: 'discovered',
        toState: 'installed',
        result: 'success',
      }),
      transactionManager,
    );
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('persists supported runtime operations from parsed manifest contributions', async () => {
    const manifest = {
      ...buildManifest(),
      contributions: [
        {
          id: 'summarize',
          type: 'tool',
          displayName: 'Summarize',
          config: {
            inputSchema: { type: 'object' },
          },
        },
        {
          id: 'triage-step',
          type: 'workflow.step',
          displayName: 'Triage Step',
          config: {
            stepType: 'plugin.triage',
            inputContract: { type: 'object' },
            operation: 'triage_issue',
          },
        },
      ],
    };
    repository.findByPluginIdAndVersion.mockResolvedValue(null);
    repository.saveEntry.mockResolvedValue(buildEntry());

    await service.installPlugin({
      manifest,
      source: '@acme/workflow-tools',
      actorId,
    });

    expect(repository.saveEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        contributions: [
          expect.objectContaining({
            id: 'summarize',
            config: expect.objectContaining({ operation: 'execute' }),
          }),
          expect.objectContaining({
            id: 'triage-step',
            config: expect.objectContaining({ operation: 'triage_issue' }),
          }),
        ],
        metadata: expect.objectContaining({
          supportedContributionOperations: {
            summarize: ['execute'],
            'triage-step': ['triage_issue'],
          },
        }),
      }),
      transactionManager,
    );

    const [savedPlugin] = repository.saveEntry.mock.calls[0] as [
      PluginRegistryEntry,
      EntityManager,
    ];
    const policyDecision = new PluginPolicyService().decideRuntimeInvocation({
      context: {
        pluginId: savedPlugin.plugin_id,
        version: savedPlugin.version,
        trustLevel: savedPlugin.trust_level,
        isolationMode: savedPlugin.isolation_mode,
        lifecycleState: 'enabled',
        enabled: true,
        requestedPermissions: savedPlugin.requested_permissions,
        grantedPermissions: savedPlugin.granted_permissions,
        contributions: savedPlugin.contributions,
        scanStatus: 'passed',
        compatibilityStatus: 'passed',
        runtimeHealth: 'healthy',
        supportedContributionOperations: savedPlugin.metadata
          ?.supportedContributionOperations as Readonly<
          Record<string, readonly string[]>
        >,
      },
      contributionId: 'summarize',
      operation: 'execute',
    });

    expect(policyDecision).toEqual({ allowed: true });
  });

  it('rejects install audit failures through the transaction boundary', async () => {
    const manifest = buildManifest();
    const savedEntry = buildEntry();
    repository.findByPluginIdAndVersion.mockResolvedValue(null);
    repository.saveEntry.mockResolvedValue(savedEntry);
    audit.recordLifecycleEvent.mockRejectedValue(
      new InternalServerErrorException('audit unavailable'),
    );

    await expect(
      service.installPlugin({
        manifest,
        source: '@acme/workflow-tools',
        actorId,
      }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(repository.saveEntry).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycle_state: 'installed' }),
      transactionManager,
    );
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'install', toState: 'installed' }),
      transactionManager,
    );
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid manifests during install', async () => {
    await expect(
      service.installPlugin({
        manifest: { id: 'missing-required-fields' },
        source: '@acme/workflow-tools',
        actorId,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects install isolation modes not declared by the manifest', async () => {
    const manifest = buildManifest({ isolationModes: ['worker_process'] });
    repository.findByPluginIdAndVersion.mockResolvedValue(null);
    repository.saveEntry.mockResolvedValue(
      buildEntry({ isolation_mode: 'container' }),
    );

    await expect(
      service.installPlugin({
        manifest,
        source: '@acme/workflow-tools',
        actorId,
        isolationMode: 'container',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(repository.saveEntry).not.toHaveBeenCalled();
    expect(audit.recordLifecycleEvent).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects quarantined trust level during install', async () => {
    const manifest = buildManifest();
    repository.findByPluginIdAndVersion.mockResolvedValue(null);
    repository.saveEntry.mockResolvedValue(
      buildEntry({ trust_level: 'quarantined' }),
    );

    await expect(
      service.installPlugin({
        manifest,
        source: '@acme/workflow-tools',
        actorId,
        trustLevel: 'quarantined',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(repository.saveEntry).not.toHaveBeenCalled();
    expect(audit.recordLifecycleEvent).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects reinstall after uninstall without inserting a duplicate row', async () => {
    const manifest = buildManifest();
    repository.findByPluginIdAndVersion.mockResolvedValue(
      buildEntry({ lifecycle_state: 'uninstalled' }),
    );

    await expect(
      service.installPlugin({
        manifest,
        source: '@acme/workflow-tools',
        actorId,
      }),
    ).rejects.toThrow(ConflictException);

    expect(repository.saveEntry).not.toHaveBeenCalled();
    expect(audit.recordLifecycleEvent).not.toHaveBeenCalled();
  });

  it('scans an installed plugin and emits audit', async () => {
    const installed = buildEntry({ lifecycle_state: 'installed' });
    const scanned = buildEntry({
      lifecycle_state: 'scanned',
      scan_result: { verdict: 'passed' },
      compatibility_result: { api: 'compatible' },
    });
    repository.findByPluginIdAndVersion.mockResolvedValue(installed);
    repository.markLifecycleState.mockResolvedValue(scanned);

    const result = await service.scanPlugin({
      pluginId: installed.plugin_id,
      version: installed.version,
      actorId,
      scanResult: { verdict: 'passed' },
      compatibilityResult: { api: 'compatible' },
    });

    expect(result).toEqual(scanned);
    expect(repository.markLifecycleState).toHaveBeenCalledWith(
      installed.id,
      'installed',
      'scanned',
      expect.any(Date),
      {
        scan_result: { verdict: 'passed' },
        compatibility_result: { api: 'compatible' },
      },
      transactionManager,
    );
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'scan',
        fromState: 'installed',
        toState: 'scanned',
      }),
      transactionManager,
    );
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(
      projectionOrchestrator.refreshProjectedContributions,
    ).toHaveBeenCalledTimes(1);
  });

  it('enables a scanned plugin and emits audit', async () => {
    const scanned = buildEntry({ lifecycle_state: 'scanned' });
    const enabled = buildEntry({ lifecycle_state: 'enabled', enabled: true });
    repository.findByPluginIdAndVersion.mockResolvedValue(scanned);
    repository.markLifecycleState.mockResolvedValue(enabled);

    const result = await service.enablePlugin({
      pluginId: scanned.plugin_id,
      version: scanned.version,
      actorId,
    });

    expect(result).toEqual(enabled);
    expect(repository.markLifecycleState).toHaveBeenCalledWith(
      scanned.id,
      'scanned',
      'enabled',
      expect.any(Date),
      undefined,
      transactionManager,
    );
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'enable', toState: 'enabled' }),
      transactionManager,
    );
    expect(
      projectionOrchestrator.refreshProjectedContributions,
    ).toHaveBeenCalledTimes(1);
  });

  it('disables an enabled plugin and emits audit', async () => {
    const enabled = buildEntry({ lifecycle_state: 'enabled', enabled: true });
    const disabled = buildEntry({
      lifecycle_state: 'disabled',
      enabled: false,
    });
    repository.findByPluginIdAndVersion.mockResolvedValue(enabled);
    repository.markLifecycleState.mockResolvedValue(disabled);

    const result = await service.disablePlugin({
      pluginId: enabled.plugin_id,
      version: enabled.version,
      actorId,
    });

    expect(result).toEqual(disabled);
    expect(repository.markLifecycleState).toHaveBeenCalledWith(
      enabled.id,
      'enabled',
      'disabled',
      expect.any(Date),
      undefined,
      transactionManager,
    );
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'disable', toState: 'disabled' }),
      transactionManager,
    );
    expect(
      projectionOrchestrator.cleanupProjectedContributions,
    ).toHaveBeenCalledWith({
      pluginId: enabled.plugin_id,
      version: enabled.version,
    });
  });

  it('cleans projections after the disable lifecycle transaction succeeds before returning success', async () => {
    const enabled = buildEntry({ lifecycle_state: 'enabled', enabled: true });
    const disabled = buildEntry({
      lifecycle_state: 'disabled',
      enabled: false,
    });
    const callOrder: string[] = [];
    repository.findByPluginIdAndVersion.mockResolvedValue(enabled);
    projectionOrchestrator.cleanupProjectedContributions.mockImplementation(
      () => {
        callOrder.push('cleanup');
        return Promise.resolve({
          ok: true,
          action: 'cleanup',
          results: { tools: [], workflowSteps: [], workflowHooks: [] },
          errors: [],
        });
      },
    );
    repository.markLifecycleState.mockImplementation(() => {
      callOrder.push('update');
      return Promise.resolve(disabled);
    });
    audit.recordLifecycleEvent.mockImplementation(() => {
      callOrder.push('audit');
      return Promise.resolve(undefined);
    });

    await service.disablePlugin({
      pluginId: enabled.plugin_id,
      version: enabled.version,
      actorId,
    });

    expect(callOrder).toEqual(['update', 'audit', 'cleanup']);
  });

  it('does not clean projections when disable loses a concurrent lifecycle update', async () => {
    const enabled = buildEntry({ lifecycle_state: 'enabled', enabled: true });
    repository.findByPluginIdAndVersion.mockResolvedValue(enabled);
    repository.markLifecycleState.mockResolvedValue(null);

    await expect(
      service.disablePlugin({
        pluginId: enabled.plugin_id,
        version: enabled.version,
        actorId,
      }),
    ).rejects.toThrow(ConflictException);

    expect(
      projectionOrchestrator.cleanupProjectedContributions,
    ).not.toHaveBeenCalled();
  });

  it('does not clean projections when disable audit fails and rolls back', async () => {
    const enabled = buildEntry({ lifecycle_state: 'enabled', enabled: true });
    const disabled = buildEntry({
      lifecycle_state: 'disabled',
      enabled: false,
    });
    repository.findByPluginIdAndVersion.mockResolvedValue(enabled);
    repository.markLifecycleState.mockResolvedValue(disabled);
    audit.recordLifecycleEvent.mockRejectedValue(
      new InternalServerErrorException('audit unavailable'),
    );

    await expect(
      service.disablePlugin({
        pluginId: enabled.plugin_id,
        version: enabled.version,
        actorId,
      }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(
      projectionOrchestrator.cleanupProjectedContributions,
    ).not.toHaveBeenCalled();
  });

  it('returns safe errors after committed lifecycle mutation when projection cleanup fails during disable', async () => {
    const enabled = buildEntry({ lifecycle_state: 'enabled', enabled: true });
    const disabled = buildEntry({
      lifecycle_state: 'disabled',
      enabled: false,
    });
    repository.findByPluginIdAndVersion.mockResolvedValue(enabled);
    repository.markLifecycleState.mockResolvedValue(disabled);
    projectionOrchestrator.cleanupProjectedContributions.mockResolvedValue({
      ok: false,
      action: 'cleanup',
      results: { tools: [], workflowSteps: [], workflowHooks: [] },
      errors: [
        {
          adapter: 'tools',
          code: 'plugin_projection_cleanup_failed',
          message: 'Plugin projection cleanup failed.',
        },
      ],
    });

    await expect(
      service.disablePlugin({
        pluginId: enabled.plugin_id,
        version: enabled.version,
        actorId,
      }),
    ).rejects.toMatchObject({
      response: {
        message: 'Plugin projection cleanup failed.',
        code: 'plugin_projection_cleanup_failed',
      },
    });

    expect(repository.markLifecycleState).toHaveBeenCalledWith(
      enabled.id,
      'enabled',
      'disabled',
      expect.any(Date),
      undefined,
      transactionManager,
    );
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'disable', toState: 'disabled' }),
      transactionManager,
    );
  });

  it('retries disable projection cleanup when the plugin is already disabled', async () => {
    const enabled = buildEntry({ lifecycle_state: 'enabled', enabled: true });
    const disabled = buildEntry({
      lifecycle_state: 'disabled',
      enabled: false,
    });
    repository.findByPluginIdAndVersion
      .mockResolvedValueOnce(enabled)
      .mockResolvedValueOnce(disabled);
    repository.markLifecycleState.mockResolvedValue(disabled);
    projectionOrchestrator.cleanupProjectedContributions
      .mockResolvedValueOnce({
        ok: false,
        action: 'cleanup',
        results: { tools: [], workflowSteps: [], workflowHooks: [] },
        errors: [
          {
            adapter: 'tools',
            code: 'plugin_projection_cleanup_failed',
            message: 'Plugin projection cleanup failed.',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        action: 'cleanup',
        results: { tools: [], workflowSteps: [], workflowHooks: [] },
        errors: [],
      });

    await expect(
      service.disablePlugin({
        pluginId: enabled.plugin_id,
        version: enabled.version,
        actorId,
      }),
    ).rejects.toMatchObject({
      response: { code: 'plugin_projection_cleanup_failed' },
    });

    await expect(
      service.disablePlugin({
        pluginId: disabled.plugin_id,
        version: disabled.version,
        actorId,
      }),
    ).resolves.toEqual(disabled);
    expect(repository.markLifecycleState).toHaveBeenCalledTimes(1);
    expect(audit.recordLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(
      projectionOrchestrator.cleanupProjectedContributions,
    ).toHaveBeenCalledTimes(2);
  });

  it('returns safe errors after committed lifecycle mutation when projection refresh fails during scan', async () => {
    const installed = buildEntry({ lifecycle_state: 'installed' });
    const scanned = buildEntry({ lifecycle_state: 'scanned' });
    repository.findByPluginIdAndVersion.mockResolvedValue(installed);
    repository.markLifecycleState.mockResolvedValue(scanned);
    projectionOrchestrator.refreshProjectedContributions.mockResolvedValue({
      ok: false,
      action: 'refresh',
      results: { tools: [], workflowSteps: [], workflowHooks: [] },
      errors: [
        {
          adapter: 'workflowHooks',
          code: 'plugin_projection_refresh_failed',
          message: 'Plugin projection refresh failed.',
        },
      ],
    });

    await expect(
      service.scanPlugin({
        pluginId: installed.plugin_id,
        version: installed.version,
        actorId,
      }),
    ).rejects.toMatchObject({
      response: {
        message: 'Plugin projection refresh failed.',
        code: 'plugin_projection_refresh_failed',
      },
    });
    expect(repository.markLifecycleState).toHaveBeenCalledWith(
      installed.id,
      'installed',
      'scanned',
      expect.any(Date),
      {},
      transactionManager,
    );
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'scan', toState: 'scanned' }),
      transactionManager,
    );
  });

  it('retries scan projection refresh when the plugin is already scanned', async () => {
    const installed = buildEntry({ lifecycle_state: 'installed' });
    const scanned = buildEntry({ lifecycle_state: 'scanned' });
    repository.findByPluginIdAndVersion
      .mockResolvedValueOnce(installed)
      .mockResolvedValueOnce(scanned);
    repository.markLifecycleState.mockResolvedValue(scanned);
    projectionOrchestrator.refreshProjectedContributions
      .mockResolvedValueOnce({
        ok: false,
        action: 'refresh',
        results: { tools: [], workflowSteps: [], workflowHooks: [] },
        errors: [
          {
            adapter: 'workflowSteps',
            code: 'plugin_projection_refresh_failed',
            message: 'Plugin projection refresh failed.',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        action: 'refresh',
        results: { tools: [], workflowSteps: [], workflowHooks: [] },
        errors: [],
      });

    await expect(
      service.scanPlugin({
        pluginId: installed.plugin_id,
        version: installed.version,
        actorId,
      }),
    ).rejects.toMatchObject({
      response: { code: 'plugin_projection_refresh_failed' },
    });

    await expect(
      service.scanPlugin({
        pluginId: scanned.plugin_id,
        version: scanned.version,
        actorId,
      }),
    ).resolves.toEqual(scanned);
    expect(repository.markLifecycleState).toHaveBeenCalledTimes(1);
    expect(audit.recordLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(
      projectionOrchestrator.refreshProjectedContributions,
    ).toHaveBeenCalledTimes(2);
  });

  it('returns safe errors after committed lifecycle mutation when projection refresh fails during enable', async () => {
    const scanned = buildEntry({ lifecycle_state: 'scanned' });
    const enabled = buildEntry({ lifecycle_state: 'enabled', enabled: true });
    repository.findByPluginIdAndVersion.mockResolvedValue(scanned);
    repository.markLifecycleState.mockResolvedValue(enabled);
    projectionOrchestrator.refreshProjectedContributions.mockResolvedValue({
      ok: false,
      action: 'refresh',
      results: { tools: [], workflowSteps: [], workflowHooks: [] },
      errors: [
        {
          adapter: 'tools',
          code: 'plugin_projection_refresh_failed',
          message: 'Plugin projection refresh failed.',
        },
      ],
    });

    await expect(
      service.enablePlugin({
        pluginId: scanned.plugin_id,
        version: scanned.version,
        actorId,
      }),
    ).rejects.toMatchObject({
      response: {
        message: 'Plugin projection refresh failed.',
        code: 'plugin_projection_refresh_failed',
      },
    });
    expect(repository.markLifecycleState).toHaveBeenCalledWith(
      scanned.id,
      'scanned',
      'enabled',
      expect.any(Date),
      undefined,
      transactionManager,
    );
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'enable', toState: 'enabled' }),
      transactionManager,
    );
  });

  it('retries enable projection refresh when the plugin is already enabled', async () => {
    const scanned = buildEntry({ lifecycle_state: 'scanned' });
    const enabled = buildEntry({ lifecycle_state: 'enabled', enabled: true });
    repository.findByPluginIdAndVersion
      .mockResolvedValueOnce(scanned)
      .mockResolvedValueOnce(enabled);
    repository.markLifecycleState.mockResolvedValue(enabled);
    projectionOrchestrator.refreshProjectedContributions
      .mockResolvedValueOnce({
        ok: false,
        action: 'refresh',
        results: { tools: [], workflowSteps: [], workflowHooks: [] },
        errors: [
          {
            adapter: 'tools',
            code: 'plugin_projection_refresh_failed',
            message: 'Plugin projection refresh failed.',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        action: 'refresh',
        results: { tools: [], workflowSteps: [], workflowHooks: [] },
        errors: [],
      });

    await expect(
      service.enablePlugin({
        pluginId: scanned.plugin_id,
        version: scanned.version,
        actorId,
      }),
    ).rejects.toMatchObject({
      response: { code: 'plugin_projection_refresh_failed' },
    });

    await expect(
      service.enablePlugin({
        pluginId: enabled.plugin_id,
        version: enabled.version,
        actorId,
      }),
    ).resolves.toEqual(enabled);
    expect(repository.markLifecycleState).toHaveBeenCalledTimes(1);
    expect(audit.recordLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(
      projectionOrchestrator.refreshProjectedContributions,
    ).toHaveBeenCalledTimes(2);
  });

  it('quarantines a plugin from an allowed state and emits audit', async () => {
    const enabled = buildEntry({ lifecycle_state: 'enabled', enabled: true });
    const quarantined = buildEntry({
      lifecycle_state: 'quarantined',
      trust_level: 'quarantined',
      enabled: false,
    });
    repository.findByPluginIdAndVersion.mockResolvedValue(enabled);
    repository.markLifecycleState.mockResolvedValue(quarantined);

    const result = await service.quarantinePlugin({
      pluginId: enabled.plugin_id,
      version: enabled.version,
      actorId,
      reason: 'malware signature',
    });

    expect(result).toEqual(quarantined);
    expect(repository.markLifecycleState).toHaveBeenCalledWith(
      enabled.id,
      'enabled',
      'quarantined',
      expect.any(Date),
      { trust_level: 'quarantined' },
      transactionManager,
    );
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quarantine',
        toState: 'quarantined',
        metadata: { reason: 'malware signature' },
      }),
      transactionManager,
    );
    expect(
      projectionOrchestrator.cleanupProjectedContributions,
    ).toHaveBeenCalledWith({
      pluginId: enabled.plugin_id,
      version: enabled.version,
    });
  });

  it('returns safe errors after committed lifecycle mutation when projection cleanup fails during quarantine', async () => {
    const enabled = buildEntry({ lifecycle_state: 'enabled', enabled: true });
    const quarantined = buildEntry({
      lifecycle_state: 'quarantined',
      trust_level: 'quarantined',
      enabled: false,
    });
    repository.findByPluginIdAndVersion.mockResolvedValue(enabled);
    repository.markLifecycleState.mockResolvedValue(quarantined);
    projectionOrchestrator.cleanupProjectedContributions.mockResolvedValue({
      ok: false,
      action: 'cleanup',
      results: { tools: [], workflowSteps: [], workflowHooks: [] },
      errors: [
        {
          adapter: 'workflowHooks',
          code: 'plugin_projection_cleanup_failed',
          message: 'Plugin projection cleanup failed.',
        },
      ],
    });

    await expect(
      service.quarantinePlugin({
        pluginId: enabled.plugin_id,
        version: enabled.version,
        actorId,
        reason: 'malware signature',
      }),
    ).rejects.toMatchObject({
      response: {
        message: 'Plugin projection cleanup failed.',
        code: 'plugin_projection_cleanup_failed',
      },
    });

    expect(repository.markLifecycleState).toHaveBeenCalledWith(
      enabled.id,
      'enabled',
      'quarantined',
      expect.any(Date),
      { trust_level: 'quarantined' },
      transactionManager,
    );
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'quarantine', toState: 'quarantined' }),
      transactionManager,
    );
  });

  it('retries quarantine projection cleanup when the plugin is already quarantined', async () => {
    const enabled = buildEntry({ lifecycle_state: 'enabled', enabled: true });
    const quarantined = buildEntry({
      lifecycle_state: 'quarantined',
      trust_level: 'quarantined',
      enabled: false,
    });
    repository.findByPluginIdAndVersion
      .mockResolvedValueOnce(enabled)
      .mockResolvedValueOnce(quarantined);
    repository.markLifecycleState.mockResolvedValue(quarantined);
    projectionOrchestrator.cleanupProjectedContributions
      .mockResolvedValueOnce({
        ok: false,
        action: 'cleanup',
        results: { tools: [], workflowSteps: [], workflowHooks: [] },
        errors: [
          {
            adapter: 'workflowSteps',
            code: 'plugin_projection_cleanup_failed',
            message: 'Plugin projection cleanup failed.',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        action: 'cleanup',
        results: { tools: [], workflowSteps: [], workflowHooks: [] },
        errors: [],
      });

    await expect(
      service.quarantinePlugin({
        pluginId: enabled.plugin_id,
        version: enabled.version,
        actorId,
        reason: 'malware signature',
      }),
    ).rejects.toMatchObject({
      response: { code: 'plugin_projection_cleanup_failed' },
    });

    await expect(
      service.quarantinePlugin({
        pluginId: quarantined.plugin_id,
        version: quarantined.version,
        actorId,
        reason: 'malware signature',
      }),
    ).resolves.toEqual(quarantined);
    expect(repository.markLifecycleState).toHaveBeenCalledTimes(1);
    expect(audit.recordLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(
      projectionOrchestrator.cleanupProjectedContributions,
    ).toHaveBeenCalledTimes(2);
  });

  it('uninstalls a plugin and emits audit', async () => {
    const disabled = buildEntry({ lifecycle_state: 'disabled' });
    const uninstalled = buildEntry({ lifecycle_state: 'uninstalled' });
    repository.findByPluginIdAndVersion.mockResolvedValue(disabled);
    repository.markLifecycleState.mockResolvedValue(uninstalled);

    const result = await service.uninstallPlugin({
      pluginId: disabled.plugin_id,
      version: disabled.version,
      actorId,
    });

    expect(result).toEqual(uninstalled);
    expect(repository.markLifecycleState).toHaveBeenCalledWith(
      disabled.id,
      'disabled',
      'uninstalled',
      expect.any(Date),
      undefined,
      transactionManager,
    );
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'uninstall', toState: 'uninstalled' }),
      transactionManager,
    );
    expect(
      projectionOrchestrator.cleanupProjectedContributions,
    ).toHaveBeenCalledWith({
      pluginId: disabled.plugin_id,
      version: disabled.version,
    });
  });

  it('returns safe errors after committed lifecycle mutation when projection cleanup fails during uninstall', async () => {
    const disabled = buildEntry({ lifecycle_state: 'disabled' });
    const uninstalled = buildEntry({ lifecycle_state: 'uninstalled' });
    repository.findByPluginIdAndVersion.mockResolvedValue(disabled);
    repository.markLifecycleState.mockResolvedValue(uninstalled);
    projectionOrchestrator.cleanupProjectedContributions.mockResolvedValue({
      ok: false,
      action: 'cleanup',
      results: { tools: [], workflowSteps: [], workflowHooks: [] },
      errors: [
        {
          adapter: 'tools',
          code: 'plugin_projection_cleanup_failed',
          message: 'Plugin projection cleanup failed.',
        },
      ],
    });

    await expect(
      service.uninstallPlugin({
        pluginId: disabled.plugin_id,
        version: disabled.version,
        actorId,
      }),
    ).rejects.toMatchObject({
      response: {
        message: 'Plugin projection cleanup failed.',
        code: 'plugin_projection_cleanup_failed',
      },
    });

    expect(repository.markLifecycleState).toHaveBeenCalledWith(
      disabled.id,
      'disabled',
      'uninstalled',
      expect.any(Date),
      undefined,
      transactionManager,
    );
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'uninstall', toState: 'uninstalled' }),
      transactionManager,
    );
  });

  it('retries uninstall projection cleanup when the plugin is already uninstalled', async () => {
    const disabled = buildEntry({ lifecycle_state: 'disabled' });
    const uninstalled = buildEntry({ lifecycle_state: 'uninstalled' });
    repository.findByPluginIdAndVersion
      .mockResolvedValueOnce(disabled)
      .mockResolvedValueOnce(uninstalled);
    repository.markLifecycleState.mockResolvedValue(uninstalled);
    projectionOrchestrator.cleanupProjectedContributions
      .mockResolvedValueOnce({
        ok: false,
        action: 'cleanup',
        results: { tools: [], workflowSteps: [], workflowHooks: [] },
        errors: [
          {
            adapter: 'workflowHooks',
            code: 'plugin_projection_cleanup_failed',
            message: 'Plugin projection cleanup failed.',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        action: 'cleanup',
        results: { tools: [], workflowSteps: [], workflowHooks: [] },
        errors: [],
      });

    await expect(
      service.uninstallPlugin({
        pluginId: disabled.plugin_id,
        version: disabled.version,
        actorId,
      }),
    ).rejects.toMatchObject({
      response: { code: 'plugin_projection_cleanup_failed' },
    });

    await expect(
      service.uninstallPlugin({
        pluginId: uninstalled.plugin_id,
        version: uninstalled.version,
        actorId,
      }),
    ).resolves.toEqual(uninstalled);
    expect(repository.markLifecycleState).toHaveBeenCalledTimes(1);
    expect(audit.recordLifecycleEvent).toHaveBeenCalledTimes(1);
    expect(
      projectionOrchestrator.cleanupProjectedContributions,
    ).toHaveBeenCalledTimes(2);
  });

  it('rejects lifecycle operations that violate allowed transitions', async () => {
    const installed = buildEntry({ lifecycle_state: 'installed' });
    repository.findByPluginIdAndVersion.mockResolvedValue(installed);

    await expect(
      service.enablePlugin({
        pluginId: installed.plugin_id,
        version: installed.version,
        actorId,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(repository.markLifecycleState).not.toHaveBeenCalled();
    expect(audit.recordLifecycleEvent).not.toHaveBeenCalled();
  });

  it('fails cleanly without audit when lifecycle state changed concurrently', async () => {
    const installed = buildEntry({ lifecycle_state: 'installed' });
    repository.findByPluginIdAndVersion.mockResolvedValue(installed);
    repository.markLifecycleState.mockResolvedValue(null);

    await expect(
      service.scanPlugin({
        pluginId: installed.plugin_id,
        version: installed.version,
        actorId,
      }),
    ).rejects.toThrow(ConflictException);

    expect(repository.markLifecycleState).toHaveBeenCalledWith(
      installed.id,
      'installed',
      'scanned',
      expect.any(Date),
      {},
      transactionManager,
    );
    expect(audit.recordLifecycleEvent).not.toHaveBeenCalled();
  });

  it('rejects audit failures through the transaction boundary after lifecycle update', async () => {
    const scanned = buildEntry({ lifecycle_state: 'scanned' });
    const enabled = buildEntry({ lifecycle_state: 'enabled', enabled: true });
    repository.findByPluginIdAndVersion.mockResolvedValue(scanned);
    repository.markLifecycleState.mockResolvedValue(enabled);
    audit.recordLifecycleEvent.mockRejectedValue(
      new InternalServerErrorException('audit unavailable'),
    );

    await expect(
      service.enablePlugin({
        pluginId: scanned.plugin_id,
        version: scanned.version,
        actorId,
      }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(repository.markLifecycleState).toHaveBeenCalled();
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'enable', toState: 'enabled' }),
      transactionManager,
    );
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('uses one transaction for lifecycle update and audit writes', async () => {
    const scanned = buildEntry({ lifecycle_state: 'scanned' });
    const enabled = buildEntry({ lifecycle_state: 'enabled', enabled: true });
    repository.findByPluginIdAndVersion.mockResolvedValue(scanned);
    repository.markLifecycleState.mockResolvedValue(enabled);
    const callOrder: string[] = [];
    repository.markLifecycleState.mockImplementation(() => {
      callOrder.push('update');
      return Promise.resolve(enabled);
    });
    audit.recordLifecycleEvent.mockImplementation(() => {
      callOrder.push('audit');
      return Promise.resolve(undefined);
    });

    await service.enablePlugin({
      pluginId: scanned.plugin_id,
      version: scanned.version,
      actorId,
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(repository.markLifecycleState).toHaveBeenCalledWith(
      scanned.id,
      'scanned',
      'enabled',
      expect.any(Date),
      undefined,
      transactionManager,
    );
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'enable', toState: 'enabled' }),
      transactionManager,
    );
    expect(callOrder).toEqual(['update', 'audit']);
  });

  it('inspects a plugin by identity', async () => {
    const entry = buildEntry();
    repository.findByPluginIdAndVersion.mockResolvedValue(entry);

    await expect(
      service.inspectPlugin(entry.plugin_id, entry.version),
    ).resolves.toEqual(entry);
  });

  it('throws not found when inspecting a missing plugin', async () => {
    repository.findByPluginIdAndVersion.mockResolvedValue(null);

    await expect(
      service.inspectPlugin('com.acme.missing', '1.0.0'),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists active plugins', async () => {
    const entries = [
      buildEntry(),
      buildEntry({ id: 'entry-2', version: '2.0.0' }),
    ];
    repository.listActiveEntries.mockResolvedValue(entries);

    await expect(service.listPlugins()).resolves.toEqual(entries);
    expect(repository.listActiveEntries).toHaveBeenCalledWith();
  });

  it('lists plugins with lifecycle filters', async () => {
    const entries = [
      buildEntry({
        lifecycle_state: 'enabled',
        enabled: true,
        trust_level: 'bundled',
      }),
    ];
    repository.listActiveEntries.mockResolvedValue(entries);

    await expect(
      service.listPlugins({
        state: 'enabled',
        enabled: true,
        trustLevel: 'bundled',
      }),
    ).resolves.toEqual(entries);
    expect(repository.listActiveEntries).toHaveBeenCalledWith({
      state: 'enabled',
      enabled: true,
      trustLevel: 'bundled',
    });
  });
});
