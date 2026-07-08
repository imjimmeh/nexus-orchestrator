import type { PluginManifestDiscoveryResult } from "../plugin-platform.types";

/**
 * Health status for the plugin platform service.
 */
export interface PluginPlatformServiceHealth {
  /** Overall health status. */
  readonly status: "ok" | "degraded";
  /** Number of plugins discovered from configured directories. */
  readonly plugins_discovered: number;
  /** Uptime in milliseconds since the service was started. */
  readonly uptime_ms: number;
}

/**
 * Events emitted by the PluginPlatformService.
 */
export interface PluginPlatformServiceEvents {
  /** Fired when the service has started. */
  readonly started: [];
  /** Fired when the service has stopped. */
  readonly stopped: [];
  /** Fired when a manifest discovery scan completes. */
  readonly discovery_complete: [
    {
      readonly manifestsFound: number;
      readonly errors: number;
      readonly manifests: PluginManifestDiscoveryResult[];
    },
  ];
}
