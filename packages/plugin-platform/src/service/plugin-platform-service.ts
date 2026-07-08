import { EventEmitter } from "node:events";
import { PluginManifestDiscoveryService } from "../manifest/plugin-manifest-discovery.service";
import type { PluginPlatformConfig } from "../plugin-platform.types";
import type { PluginPlatformServiceHealth } from "./plugin-platform-service.types";

/**
 * Standalone entrypoint for the plugin platform.
 *
 * Wraps the manifest discovery service and provides a health endpoint,
 * startup/shutdown lifecycle, and uptime tracking.
 *
 * This class does NOT depend on NestJS - it is a plain Node.js service
 * that can be used independently or embedded in a NestJS application.
 */
export class PluginPlatformService extends EventEmitter {
  private readonly config: PluginPlatformConfig;
  private readonly discovery: PluginManifestDiscoveryService;
  private startedAt: number | null = null;
  private pluginsDiscovered = 0;

  constructor(config: PluginPlatformConfig) {
    super();
    this.config = config;
    this.discovery = new PluginManifestDiscoveryService();
  }

  /**
   * Start the service: run manifest discovery against configured directories.
   */
  async start(): Promise<void> {
    if (this.startedAt !== null) {
      return;
    }

    this.startedAt = Date.now();

    try {
      const result = await this.discovery.discover({
        directories: this.config.manifestDirectories,
      });

      this.pluginsDiscovered = result.manifests.length;

      this.emit("discovery_complete", {
        manifestsFound: result.manifests.length,
        errors: result.errors.length,
        manifests: result.manifests,
      });
    } catch {
      // Discovery failures are handled gracefully - we track 0 plugins.
      this.pluginsDiscovered = 0;
    }

    this.emit("started");
  }

  /**
   * Gracefully shut down the service.
   */
  async stop(): Promise<void> {
    if (this.startedAt === null) {
      return;
    }

    this.startedAt = null;
    this.pluginsDiscovered = 0;

    // Allow any async listeners to complete before resolving
    await Promise.resolve();

    this.emit("stopped");
  }

  /**
   * Return the current health status of the service.
   */
  getHealth(): PluginPlatformServiceHealth {
    const uptimeMs = this.startedAt !== null ? Date.now() - this.startedAt : 0;

    const status: PluginPlatformServiceHealth["status"] =
      this.startedAt !== null ? "ok" : "degraded";

    return {
      status,
      plugins_discovered: this.pluginsDiscovered,
      uptime_ms: uptimeMs,
    };
  }
}
