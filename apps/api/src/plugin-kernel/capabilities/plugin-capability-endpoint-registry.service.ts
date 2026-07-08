import { Injectable } from '@nestjs/common';
import {
  capabilityEndpointContributionSchema,
  type CapabilityEndpointContribution,
} from '@nexus/plugin-sdk';
import { PluginContributionRegistryService } from '../contributions/plugin-contribution-registry.service';
import type {
  PluginContributionInventoryEntry,
  PluginContributionProjectionInventoryEntry,
} from '../contributions/plugin-contribution.types';
import type {
  ListPluginCapabilityEndpointsOptions,
  PluginCapabilityEndpoint,
} from './plugin-capability-endpoint.types';

@Injectable()
export class PluginCapabilityEndpointRegistryService {
  constructor(
    private readonly contributionRegistry: PluginContributionRegistryService,
  ) {}

  async listActiveEndpoints(
    options: ListPluginCapabilityEndpointsOptions = {},
  ): Promise<PluginCapabilityEndpoint[]> {
    const entries =
      await this.contributionRegistry.listActiveContributionProjectionEntries();

    return entries
      .filter((entry) => this.isValidEndpointEntry(entry))
      .map((entry) => this.toEndpoint(entry))
      .filter((endpoint) => {
        if (options.pluginId && endpoint.pluginId !== options.pluginId) {
          return false;
        }

        if (
          options.visibility &&
          !endpoint.visibility.includes(options.visibility)
        ) {
          return false;
        }

        return true;
      });
  }

  async findByGlobalEndpointName(
    globalEndpointName: string,
  ): Promise<PluginCapabilityEndpoint | null> {
    const endpoints = await this.listActiveEndpoints();
    return (
      endpoints.find(
        (endpoint) => endpoint.globalEndpointName === globalEndpointName,
      ) ?? null
    );
  }

  async findByPluginContribution(
    pluginId: string,
    contributionId: string,
    version?: string,
  ): Promise<PluginCapabilityEndpoint | null> {
    let entry: PluginContributionInventoryEntry | null;
    if (version) {
      entry = await this.contributionRegistry.findContributionByVersion(
        pluginId,
        version,
        contributionId,
      );
    } else {
      entry = await this.contributionRegistry.findContribution(
        pluginId,
        contributionId,
      );
    }

    if (!entry || entry.type !== 'capability.endpoint') {
      return null;
    }

    const parsed = capabilityEndpointContributionSchema.safeParse(
      entry.contribution,
    );
    if (!parsed.success) {
      return null;
    }

    return this.toEndpoint({
      ...entry,
      lastValidationResult: { status: 'valid' },
    });
  }

  private isValidEndpointEntry(
    entry: PluginContributionProjectionInventoryEntry,
  ): boolean {
    if (entry.type !== 'capability.endpoint') {
      return false;
    }

    if (entry.lastValidationResult.status !== 'valid') {
      return false;
    }

    return capabilityEndpointContributionSchema.safeParse(entry.contribution)
      .success;
  }

  private toEndpoint(
    entry: PluginContributionProjectionInventoryEntry,
  ): PluginCapabilityEndpoint {
    const parsed = capabilityEndpointContributionSchema.parse(
      entry.contribution,
    ) as CapabilityEndpointContribution;

    return {
      pluginId: entry.pluginId,
      version: entry.version,
      contributionId: parsed.id,
      globalEndpointName: entry.globalCapabilityName,
      displayName: parsed.displayName,
      description: parsed.description,
      inputSchema: parsed.config.inputSchema,
      outputSchema: parsed.config.outputSchema,
      requiredPermissions: parsed.config.requiredPermissions ?? [],
      operation: parsed.config.operation,
      timeoutMs: parsed.config.timeoutMs,
      retryable: parsed.config.retryable ?? false,
      visibility: parsed.config.visibility,
    };
  }
}
