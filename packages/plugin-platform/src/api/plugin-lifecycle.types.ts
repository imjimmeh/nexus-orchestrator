/**
 * Type definitions for the plugin lifecycle HTTP API.
 */

/**
 * Supported lifecycle operations.
 */
export type PluginLifecycleOperation =
  | "install"
  | "enable"
  | "disable"
  | "uninstall";

/**
 * Request payload for a lifecycle operation.
 */
export interface PluginLifecycleRequest {
  /** The ID of the plugin to operate on. */
  readonly pluginId: string;
  /** The lifecycle operation to perform. */
  readonly operation: PluginLifecycleOperation;
  /** Optional additional parameters for the operation. */
  readonly options?: Record<string, unknown>;
}

/**
 * Response from a lifecycle operation.
 */
export interface PluginLifecycleResponse {
  /** Whether the operation succeeded. */
  readonly success: boolean;
  /** The ID of the plugin that was operated on. */
  readonly pluginId: string;
  /** The operation that was performed. */
  readonly operation: PluginLifecycleOperation;
  /** The resulting lifecycle state of the plugin. */
  readonly state: string;
  /** Error message if the operation failed. */
  readonly error?: string;
}

/**
 * Response for listing all known plugins and their lifecycle states.
 */
export interface PluginLifecycleListResponse {
  /** All currently known plugins with their states. */
  readonly plugins: Array<{
    pluginId: string;
    state: string;
    manifestRef: string;
  }>;
}
