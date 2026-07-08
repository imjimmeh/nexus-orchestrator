import { BadRequestException, Injectable } from '@nestjs/common';
import {
  pluginContributionSchema,
  type PluginContribution,
  pluginContributionTypes,
} from '@nexus/plugin-sdk';
import type { PluginRegistryEntry } from '../database/entities/plugin-registry-entry.entity';
import { PluginRegistryEntryRepository } from '../database/repositories/plugin-registry-entry.repository';
import type {
  PluginContributionCleanupCandidate,
  PluginContributionCleanupRequest,
  PluginContributionInventoryEntry,
  PluginContributionProjectionInventoryEntry,
} from './plugin-contribution.types';

const DEFAULT_OPERATION = 'execute';

@Injectable()
export class PluginContributionRegistryService {
  constructor(
    private readonly registryEntries: PluginRegistryEntryRepository,
  ) {}

  async listActiveContributions(): Promise<PluginContributionInventoryEntry[]> {
    const entries = await this.registryEntries.listActiveEntries({
      state: 'enabled',
      enabled: true,
    });

    return entries
      .filter((entry) => this.isActiveContributionEntry(entry))
      .flatMap((entry) => this.toInventoryEntries(entry));
  }

  async listActiveContributionProjectionEntries(): Promise<
    PluginContributionProjectionInventoryEntry[]
  > {
    const entries = await this.registryEntries.listActiveEntries({
      state: 'enabled',
      enabled: true,
    });

    return entries
      .filter((entry) => this.isActiveContributionEntry(entry))
      .flatMap((entry) => this.toProjectionInventoryEntries(entry));
  }

  async findContribution(
    pluginId: string,
    contributionId: string,
  ): Promise<PluginContributionInventoryEntry | null> {
    const inventory = await this.listActiveContributions();
    return (
      inventory.find(
        (entry) =>
          entry.pluginId === pluginId &&
          entry.contributionId === contributionId,
      ) ?? null
    );
  }

  async findContributionByVersion(
    pluginId: string,
    version: string,
    contributionId: string,
  ): Promise<PluginContributionInventoryEntry | null> {
    const entry = await this.registryEntries.findByPluginIdAndVersion(
      pluginId,
      version,
    );
    if (!entry || !this.isActiveContributionEntry(entry)) {
      return null;
    }

    return (
      this.toInventoryEntries(entry).find(
        (inventoryEntry) => inventoryEntry.contributionId === contributionId,
      ) ?? null
    );
  }

  async findContributionByGlobalCapabilityName(
    globalCapabilityName: string,
    version?: string,
  ): Promise<PluginContributionInventoryEntry | null> {
    const matches = await this.findContributionsByGlobalCapabilityName(
      globalCapabilityName,
      version,
    );
    if (matches.length !== 1) {
      return null;
    }

    return matches[0];
  }

  async findContributionsByGlobalCapabilityName(
    globalCapabilityName: string,
    version?: string,
  ): Promise<PluginContributionInventoryEntry[]> {
    const inventory = await this.listActiveContributions();
    return inventory.filter(
      (entry) =>
        entry.globalCapabilityName === globalCapabilityName &&
        (version === undefined || entry.version === version),
    );
  }

  async calculateCleanupCandidates(
    request: PluginContributionCleanupRequest,
  ): Promise<PluginContributionCleanupCandidate[]> {
    const entries = await this.registryEntries.listEntriesForPlugin(
      request.pluginId,
      request.version,
    );
    const inventory = entries.flatMap((entry) =>
      this.toInventoryEntries(entry),
    );

    return inventory.map((entry) => ({
      pluginId: entry.pluginId,
      version: entry.version,
      contributionId: entry.contributionId,
      type: entry.type,
      globalCapabilityName: entry.globalCapabilityName,
      projectionStatus: entry.projectionStatus,
    }));
  }

  async calculateCleanupProjectionCandidates(
    request: PluginContributionCleanupRequest,
  ): Promise<PluginContributionProjectionInventoryEntry[]> {
    const entries = await this.registryEntries.listEntriesForPlugin(
      request.pluginId,
      request.version,
    );

    return entries.flatMap((entry) => this.toProjectionInventoryEntries(entry));
  }

  private isActiveContributionEntry(entry: PluginRegistryEntry): boolean {
    return entry.lifecycle_state === 'enabled' && entry.enabled;
  }

  private toInventoryEntries(
    entry: PluginRegistryEntry,
  ): PluginContributionInventoryEntry[] {
    const contributionIds = new Set<string>();

    return entry.contributions.map((rawContribution) => {
      const contribution = this.parseContribution(entry, rawContribution);
      const contributionId = contribution.id;
      if (contributionIds.has(contributionId)) {
        throw new BadRequestException(
          `Duplicate contribution id "${contributionId}" for plugin "${entry.plugin_id}"`,
        );
      }
      contributionIds.add(contributionId);

      return {
        pluginId: entry.plugin_id,
        version: entry.version,
        contributionId: contribution.id,
        type: contribution.type,
        displayName: contribution.displayName,
        contribution,
        runtimeTarget: {
          pluginId: entry.plugin_id,
          version: entry.version,
          contributionId: contribution.id,
          operation: this.getOperation(contribution),
        },
        isolationMode: entry.isolation_mode,
        permissions: entry.granted_permissions,
        projectionStatus: 'pending',
        lastValidationResult: { status: 'valid' },
        globalCapabilityName: this.toGlobalCapabilityName(
          entry.plugin_id,
          contribution.id,
        ),
      };
    });
  }

  private toProjectionInventoryEntries(
    entry: PluginRegistryEntry,
  ): PluginContributionProjectionInventoryEntry[] {
    const contributionIds = new Set<string>();

    return entry.contributions.map((rawContribution) => {
      const result = pluginContributionSchema.safeParse(rawContribution);
      if (!result.success) {
        const contributionId = this.getContributionId(rawContribution);
        return this.toInvalidInventoryEntry(
          entry,
          rawContribution,
          contributionId,
          `Invalid contribution "${contributionId}" for plugin "${entry.plugin_id}"`,
        );
      }

      const contribution = result.data as PluginContribution;
      const contributionId = contribution.id;
      if (contributionIds.has(contributionId)) {
        return this.toInvalidInventoryEntry(
          entry,
          rawContribution,
          contributionId,
          `Duplicate contribution id "${contributionId}" for plugin "${entry.plugin_id}"`,
        );
      }
      contributionIds.add(contributionId);

      return this.toInventoryEntry(entry, contribution);
    });
  }

  private toInventoryEntry(
    entry: PluginRegistryEntry,
    contribution: PluginContribution,
  ): PluginContributionInventoryEntry {
    return {
      pluginId: entry.plugin_id,
      version: entry.version,
      contributionId: contribution.id,
      type: contribution.type,
      displayName: contribution.displayName,
      contribution,
      runtimeTarget: {
        pluginId: entry.plugin_id,
        version: entry.version,
        contributionId: contribution.id,
        operation: this.getOperation(contribution),
      },
      isolationMode: entry.isolation_mode,
      permissions: entry.granted_permissions,
      projectionStatus: 'pending',
      lastValidationResult: { status: 'valid' },
      globalCapabilityName: this.toGlobalCapabilityName(
        entry.plugin_id,
        contribution.id,
      ),
    };
  }

  private toInvalidInventoryEntry(
    entry: PluginRegistryEntry,
    rawContribution: unknown,
    contributionId: string,
    errorMessage: string,
  ): PluginContributionProjectionInventoryEntry {
    return {
      pluginId: entry.plugin_id,
      version: entry.version,
      contributionId,
      type: this.getContributionType(rawContribution),
      displayName: this.getContributionDisplayName(rawContribution),
      contribution: rawContribution,
      runtimeTarget: {
        pluginId: entry.plugin_id,
        version: entry.version,
        contributionId,
        operation: DEFAULT_OPERATION,
      },
      isolationMode: entry.isolation_mode,
      permissions: entry.granted_permissions,
      projectionStatus: 'pending',
      lastValidationResult: { status: 'invalid', errorMessage },
      globalCapabilityName: this.toGlobalCapabilityName(
        entry.plugin_id,
        contributionId,
      ),
    };
  }

  private parseContribution(
    entry: PluginRegistryEntry,
    rawContribution: unknown,
  ): PluginContribution {
    const result = pluginContributionSchema.safeParse(rawContribution);
    if (!result.success) {
      throw new BadRequestException(
        `Invalid contribution "${this.getContributionId(rawContribution)}" for plugin "${entry.plugin_id}"`,
      );
    }

    return result.data;
  }

  private getContributionId(rawContribution: unknown): string {
    if (
      typeof rawContribution === 'object' &&
      rawContribution !== null &&
      'id' in rawContribution &&
      typeof rawContribution.id === 'string'
    ) {
      return rawContribution.id;
    }

    return '<unknown>';
  }

  private getContributionType(
    rawContribution: unknown,
  ): PluginContributionProjectionInventoryEntry['type'] {
    if (
      typeof rawContribution === 'object' &&
      rawContribution !== null &&
      'type' in rawContribution &&
      typeof rawContribution.type === 'string'
    ) {
      return pluginContributionTypes.includes(
        rawContribution.type as (typeof pluginContributionTypes)[number],
      )
        ? (rawContribution.type as PluginContributionProjectionInventoryEntry['type'])
        : 'invalid';
    }

    return 'invalid';
  }

  private getContributionDisplayName(rawContribution: unknown): string {
    if (
      typeof rawContribution === 'object' &&
      rawContribution !== null &&
      'displayName' in rawContribution &&
      typeof rawContribution.displayName === 'string'
    ) {
      return rawContribution.displayName;
    }

    return '<invalid>';
  }

  private getOperation(contribution: PluginContribution): string {
    if (
      contribution.config !== undefined &&
      'operation' in contribution.config &&
      typeof contribution.config.operation === 'string'
    ) {
      return contribution.config.operation;
    }

    return DEFAULT_OPERATION;
  }

  private toGlobalCapabilityName(
    pluginId: string,
    contributionId: string,
  ): string {
    return `plugin:${encodeURIComponent(pluginId)}:${encodeURIComponent(contributionId)}`;
  }
}
