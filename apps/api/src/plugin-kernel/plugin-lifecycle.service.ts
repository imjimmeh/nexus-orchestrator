import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  parsePluginManifest,
  type PluginManifestContribution,
  type PluginManifest,
  type PluginTrustLevel,
} from '@nexus/plugin-sdk';
import { DataSource, type EntityManager } from 'typeorm';
import type { PluginRegistryEntry } from './database/entities/plugin-registry-entry.entity';
import type { PluginSourceType } from './database/entities/plugin-registry-entry.types';
import { PluginRegistryEntryRepository } from './database/repositories/plugin-registry-entry.repository';
import { PLUGIN_PROJECTION_ORCHESTRATOR } from './contributions/plugin-projection-orchestrator.token';
import { PluginProjectionOrchestratorService } from './contributions/plugin-projection-orchestrator.service';
import type { PluginProjectionOrchestrationResult } from './contributions/plugin-projection-orchestrator.types';
import { PluginAuditService } from './plugin-audit.service';
import type { PluginLifecycleState } from './plugin-kernel.types';
import { PluginLifecycleStateMachineService } from './plugin-lifecycle-state-machine.service';
import type {
  DiscoverPackageOptions,
  DiscoveredPluginPackage,
  InstallPluginOptions,
  PluginIdentityOperationOptions,
  QuarantinePluginOptions,
  ListPluginFilters,
  ScanPluginOptions,
} from './plugin-lifecycle.types';

type PluginLifecycleAction =
  | 'install'
  | 'scan'
  | 'enable'
  | 'disable'
  | 'quarantine'
  | 'uninstall';

const DEFAULT_SOURCE_TYPE: PluginSourceType = 'package';
const DEFAULT_TRUST_LEVEL: PluginTrustLevel = 'third_party';
const QUARANTINED_TRUST_LEVEL: PluginTrustLevel = 'quarantined';

@Injectable()
export class PluginLifecycleService {
  constructor(
    private readonly pluginRegistryEntries: PluginRegistryEntryRepository,
    private readonly lifecycleStateMachine: PluginLifecycleStateMachineService,
    private readonly pluginAudit: PluginAuditService,
    private readonly dataSource: DataSource,
  ) {}

  @Inject(PLUGIN_PROJECTION_ORCHESTRATOR)
  private readonly projectionOrchestrator!: PluginProjectionOrchestratorService;

  discoverPackage(
    manifestValue: unknown,
    options: DiscoverPackageOptions,
  ): DiscoveredPluginPackage {
    const manifest = this.parseManifest(manifestValue);

    return {
      pluginId: manifest.id,
      version: manifest.version,
      source: options.source,
      sourceType: options.sourceType ?? DEFAULT_SOURCE_TYPE,
      manifest,
    };
  }

  async installPlugin(
    options: InstallPluginOptions,
  ): Promise<PluginRegistryEntry> {
    const discovered = this.discoverPackage(options.manifest, options);
    const existing = await this.pluginRegistryEntries.findByPluginIdAndVersion(
      discovered.pluginId,
      discovered.version,
    );

    if (existing) {
      throw new ConflictException(
        `Plugin ${discovered.pluginId}@${discovered.version} is already installed.`,
      );
    }

    this.assertInstallPolicy(discovered, options);

    this.lifecycleStateMachine.assertTransitionAllowed(
      'discovered',
      'installed',
    );

    return this.dataSource.transaction(async (manager) => {
      const entry = await this.pluginRegistryEntries.saveEntry(
        {
          plugin_id: discovered.pluginId,
          version: discovered.version,
          name: discovered.manifest.name,
          description: discovered.manifest.description ?? null,
          author: discovered.manifest.author ?? null,
          source_type: discovered.sourceType,
          source: discovered.source,
          lifecycle_state: 'installed',
          enabled: false,
          trust_level: options.trustLevel ?? DEFAULT_TRUST_LEVEL,
          isolation_mode:
            options.isolationMode ??
            discovered.manifest.isolationModes[0] ??
            'none',
          requested_permissions: discovered.manifest.permissions.map(
            (permission) => ({
              ...permission,
            }),
          ),
          granted_permissions: [],
          scan_result: null,
          compatibility_result: null,
          contributions: discovered.manifest.contributions.map(
            (contribution) => ({
              ...contribution,
            }),
          ),
          last_error: null,
          installed_at: new Date(),
          metadata: {
            package_name: discovered.manifest.packageName,
            package_version: discovered.manifest.packageVersion,
            checksum: discovered.manifest.checksum,
            signature: discovered.manifest.signature,
            nexus_compatibility: discovered.manifest.nexusCompatibility,
            entrypoints: discovered.manifest.entrypoints,
            supportedContributionOperations:
              this.deriveSupportedContributionOperations(
                discovered.manifest.contributions,
              ),
          },
        },
        manager,
      );

      await this.emitLifecycleAudit(
        {
          action: 'install',
          actorId: options.actorId,
          entry,
          fromState: 'discovered',
          toState: 'installed',
        },
        manager,
      );

      return entry;
    });
  }

  async scanPlugin(options: ScanPluginOptions): Promise<PluginRegistryEntry> {
    const stateData: Partial<PluginRegistryEntry> = {};

    if (options.scanResult !== undefined) {
      stateData.scan_result = options.scanResult;
    }

    if (options.compatibilityResult !== undefined) {
      stateData.compatibility_result = options.compatibilityResult;
    }

    return this.transitionPlugin({
      ...options,
      action: 'scan',
      toState: 'scanned',
      metadata: {
        scan_result: options.scanResult,
        compatibility_result: options.compatibilityResult,
      },
      stateData,
      refreshProjectionsAfterTransition: true,
    });
  }

  async enablePlugin(
    options: PluginIdentityOperationOptions,
  ): Promise<PluginRegistryEntry> {
    return this.transitionPlugin({
      ...options,
      action: 'enable',
      toState: 'enabled',
      refreshProjectionsAfterTransition: true,
    });
  }

  async disablePlugin(
    options: PluginIdentityOperationOptions,
  ): Promise<PluginRegistryEntry> {
    return this.transitionPlugin({
      ...options,
      action: 'disable',
      toState: 'disabled',
      cleanupProjectionsBeforeTransition: true,
    });
  }

  async quarantinePlugin(
    options: QuarantinePluginOptions,
  ): Promise<PluginRegistryEntry> {
    return this.transitionPlugin({
      ...options,
      action: 'quarantine',
      toState: 'quarantined',
      metadata: options.reason ? { reason: options.reason } : undefined,
      stateData: { trust_level: 'quarantined' },
      cleanupProjectionsBeforeTransition: true,
    });
  }

  async uninstallPlugin(
    options: PluginIdentityOperationOptions,
  ): Promise<PluginRegistryEntry> {
    return this.transitionPlugin({
      ...options,
      action: 'uninstall',
      toState: 'uninstalled',
      cleanupProjectionsBeforeTransition: true,
    });
  }

  async inspectPlugin(
    pluginId: string,
    version: string,
  ): Promise<PluginRegistryEntry> {
    return this.getPluginEntry(pluginId, version);
  }

  listPlugins(filters?: ListPluginFilters): Promise<PluginRegistryEntry[]> {
    if (filters === undefined) {
      return this.pluginRegistryEntries.listActiveEntries();
    }

    return this.pluginRegistryEntries.listActiveEntries(filters);
  }

  private parseManifest(manifestValue: unknown): PluginManifest {
    try {
      return parsePluginManifest(manifestValue);
    } catch (error) {
      throw new BadRequestException({
        message: 'Invalid plugin manifest.',
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private assertInstallPolicy(
    discovered: DiscoveredPluginPackage,
    options: InstallPluginOptions,
  ): void {
    if (options.trustLevel === QUARANTINED_TRUST_LEVEL) {
      throw new BadRequestException(
        'Install trust level cannot be quarantined.',
      );
    }

    if (
      options.isolationMode !== undefined &&
      !discovered.manifest.isolationModes.includes(options.isolationMode)
    ) {
      throw new BadRequestException(
        `Install isolation mode ${options.isolationMode} is not declared by the plugin manifest.`,
      );
    }
  }

  private deriveSupportedContributionOperations(
    contributions: readonly PluginManifestContribution[],
  ): Record<string, readonly string[]> {
    const supportedOperations: Record<string, readonly string[]> = {};

    for (const contribution of contributions) {
      if (
        contribution.type === 'tool' ||
        contribution.type === 'workflow.step'
      ) {
        supportedOperations[contribution.id] = [contribution.config.operation];
      }
    }

    return supportedOperations;
  }

  private async getPluginEntry(
    pluginId: string,
    version: string,
  ): Promise<PluginRegistryEntry> {
    const entry = await this.pluginRegistryEntries.findByPluginIdAndVersion(
      pluginId,
      version,
    );

    if (!entry) {
      throw new NotFoundException(
        `Plugin ${pluginId}@${version} was not found.`,
      );
    }

    return entry;
  }

  private async transitionPlugin(options: {
    pluginId: string;
    version: string;
    actorId: string;
    action: PluginLifecycleAction;
    toState: PluginLifecycleState;
    metadata?: Record<string, unknown>;
    stateData?: Partial<PluginRegistryEntry>;
    cleanupProjectionsBeforeTransition?: boolean;
    refreshProjectionsAfterTransition?: boolean;
  }): Promise<PluginRegistryEntry> {
    const entry = await this.getPluginEntry(options.pluginId, options.version);

    if (
      options.cleanupProjectionsBeforeTransition &&
      entry.lifecycle_state === options.toState
    ) {
      await this.cleanupProjectedContributions(
        options.pluginId,
        options.version,
      );
      return entry;
    }

    if (
      options.refreshProjectionsAfterTransition &&
      entry.lifecycle_state === options.toState
    ) {
      await this.refreshProjectedContributions();
      return entry;
    }

    this.lifecycleStateMachine.assertTransitionAllowed(
      entry.lifecycle_state,
      options.toState,
    );

    const timestamp = new Date();
    const updatedEntry = await this.dataSource.transaction(async (manager) => {
      const updatedEntry = await this.pluginRegistryEntries.markLifecycleState(
        entry.id,
        entry.lifecycle_state,
        options.toState,
        timestamp,
        options.stateData,
        manager,
      );

      if (!updatedEntry) {
        throw new ConflictException(
          `Plugin ${options.pluginId}@${options.version} lifecycle state changed before transition.`,
        );
      }

      await this.emitLifecycleAudit(
        {
          action: options.action,
          actorId: options.actorId,
          entry,
          fromState: entry.lifecycle_state,
          toState: options.toState,
          metadata: options.metadata,
        },
        manager,
      );

      return updatedEntry;
    });

    if (options.cleanupProjectionsBeforeTransition) {
      await this.cleanupProjectedContributions(
        options.pluginId,
        options.version,
      );
    }

    if (options.refreshProjectionsAfterTransition) {
      await this.refreshProjectedContributions();
    }

    return updatedEntry;
  }

  private async cleanupProjectedContributions(
    pluginId: string,
    version: string,
  ): Promise<void> {
    this.assertProjectionSuccess(
      await this.projectionOrchestrator.cleanupProjectedContributions({
        pluginId,
        version,
      }),
    );
  }

  private async refreshProjectedContributions(): Promise<void> {
    this.assertProjectionSuccess(
      await this.projectionOrchestrator.refreshProjectedContributions(),
    );
  }

  private assertProjectionSuccess(
    result: PluginProjectionOrchestrationResult,
  ): void {
    if (result.ok) return;

    const firstError = result.errors[0];
    throw new InternalServerErrorException({
      message: firstError?.message ?? 'Plugin projection operation failed.',
      code: firstError?.code ?? 'plugin_projection_operation_failed',
    });
  }

  private async emitLifecycleAudit(
    params: {
      action: PluginLifecycleAction;
      actorId: string;
      entry: Pick<PluginRegistryEntry, 'plugin_id' | 'version'>;
      fromState?: PluginLifecycleState;
      toState: PluginLifecycleState;
      metadata?: Record<string, unknown>;
    },
    manager?: EntityManager,
  ): Promise<void> {
    await this.pluginAudit.recordLifecycleEvent(
      {
        action: params.action,
        actorId: params.actorId,
        pluginId: params.entry.plugin_id,
        version: params.entry.version,
        fromState: params.fromState,
        toState: params.toState,
        result: 'success',
        metadata: params.metadata,
      },
      manager,
    );
  }
}
