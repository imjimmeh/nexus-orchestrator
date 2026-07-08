import { NotFoundException } from '@nestjs/common';

import type {
  PluginRegistryRepository,
  PluginRegistryService,
  PluginReloadSummary,
  PluginServerRecord,
  PluginTestResultParams,
} from './base-plugin-runtime-manager.service.types';

export abstract class BasePluginRuntimeManagerService<
  TServer extends PluginServerRecord,
  TDiscoveredItem,
  TReloadResult extends PluginReloadSummary<TReloadServerResult>,
  TReloadServerResult extends { ok: boolean },
  TTestResult,
> {
  protected constructor(
    private readonly registryRepository: PluginRegistryRepository,
    private readonly registryService: PluginRegistryService,
  ) {}

  async reloadAllServers(): Promise<TReloadResult> {
    const startedAt = new Date();
    const servers = await this.findAllServers();
    const results: TReloadServerResult[] = [];

    for (const server of servers) {
      results.push(await this.reloadSingleServer(server));
    }

    const completedAt = new Date();
    const succeededServers = results.filter((result) => result.ok).length;

    return this.buildReloadResult({
      started_at: startedAt,
      completed_at: completedAt,
      total_servers: results.length,
      succeeded_servers: succeededServers,
      failed_servers: results.length - succeededServers,
      results,
    });
  }

  async reloadServer(serverId: string): Promise<TReloadServerResult> {
    const server = await this.requireServer(serverId);
    return this.reloadSingleServer(server);
  }

  async testServer(serverId: string): Promise<TTestResult> {
    const server = await this.requireServer(serverId);
    const startedAt = Date.now();

    try {
      const discoveredItems = await this.discoverItemsWithRetry(server);
      return this.buildTestResult({
        server,
        ok: true,
        latencyMs: Date.now() - startedAt,
        discoveredItems,
      });
    } catch (error) {
      return this.buildTestResult({
        server,
        ok: false,
        latencyMs: Date.now() - startedAt,
        discoveredItems: [],
        error: this.getErrorMessage(error),
      });
    }
  }

  protected async removeRegisteredItemsForServer(
    namePrefix: string,
  ): Promise<number> {
    const existingItems =
      await this.registryRepository.findByNamePrefix(namePrefix);
    for (const item of existingItems) {
      await this.registryService.deleteTool(item.id);
    }
    return existingItems.length;
  }

  protected async requireServer(serverId: string): Promise<TServer> {
    const server = await this.findServerById(serverId);
    if (!server) {
      throw new NotFoundException(this.getServerNotFoundMessage(serverId));
    }
    return server;
  }

  protected abstract findAllServers(): Promise<TServer[]>;
  protected abstract findServerById(serverId: string): Promise<TServer | null>;
  protected abstract reloadSingleServer(
    server: TServer,
  ): Promise<TReloadServerResult>;
  protected abstract discoverItemsWithRetry(
    server: TServer,
  ): Promise<TDiscoveredItem[]>;
  protected abstract buildReloadResult(
    summary: PluginReloadSummary<TReloadServerResult>,
  ): TReloadResult;
  protected abstract buildTestResult(
    params: PluginTestResultParams<TServer, TDiscoveredItem>,
  ): TTestResult;
  protected abstract getServerNotFoundMessage(serverId: string): string;
  protected abstract getErrorMessage(error: unknown): string;
}
