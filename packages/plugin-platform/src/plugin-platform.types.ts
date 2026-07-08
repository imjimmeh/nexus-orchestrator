import type { PluginIsolationMode } from "@nexus/plugin-sdk";
export { pluginIsolationModes as isolationModes } from "@nexus/plugin-sdk";

/** Alias for PluginIsolationMode from the SDK. */
export type IsolationMode = PluginIsolationMode;

// Re-export PluginIsolationMode for backward compatibility
export type { PluginIsolationMode };

/**
 * Configuration for the plugin platform.
 */
export interface PluginPlatformConfig {
  /** Directories to scan for plugin manifest files. */
  readonly manifestDirectories: string[];
  /** Default runtime isolation mode to use when a plugin manifest doesn't specify one. */
  readonly defaultIsolationMode: IsolationMode;
  /** Health check endpoint configuration. */
  readonly healthCheck: PluginPlatformHealthCheckConfig;
}

/**
 * Health check endpoint configuration for the plugin platform.
 */
export interface PluginPlatformHealthCheckConfig {
  /** Whether the health endpoint is enabled. */
  readonly enabled: boolean;
  /** Path for the health endpoint (e.g. '/health/plugins'). */
  readonly path: string;
  /** Timeout in milliseconds for individual plugin health probes. */
  readonly probeTimeoutMs: number;
}

/**
 * Result of discovering a plugin manifest from configured directories.
 */
export interface PluginManifestDiscoveryResult {
  /** The absolute path to the manifest file on disk. */
  readonly manifestPath: string;
  /** The directory from which the manifest was discovered. */
  readonly sourceDirectory: string;
  /** The parsed and validated manifest data. */
  readonly manifest: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  };
  /** Whether the manifest was successfully validated. */
  readonly isValid: boolean;
  /** Validation errors, if any. */
  readonly errors: string[];
  /** Timestamp when the manifest was discovered. */
  readonly discoveredAt: Date;
}

/**
 * Result of a plugin lifecycle action (install, enable, disable, uninstall).
 */
export interface PluginLifecycleActionResult {
  /** ID of the plugin the action was performed on. */
  readonly pluginId: string;
  /** The lifecycle action that was performed. */
  readonly action: "install" | "enable" | "disable" | "uninstall";
  /** Whether the action succeeded. */
  readonly success: boolean;
  /** Human-readable message describing the result. */
  readonly message: string;
  /** Error details if the action failed. */
  readonly error?: string;
  /** Timestamp when the action was completed. */
  readonly completedAt: Date;
}
