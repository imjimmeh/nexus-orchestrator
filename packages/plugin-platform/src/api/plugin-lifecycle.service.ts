import type { PluginManifestDiscoveryResult } from "../plugin-platform.types";
import type {
  PluginLifecycleOperation,
  PluginLifecycleResponse,
  PluginLifecycleListResponse,
} from "./plugin-lifecycle.types";

/**
 * Valid lifecycle states for a plugin.
 */
type PluginLifecycleState =
  | "discovered"
  | "installed"
  | "enabled"
  | "disabled"
  | "uninstalled";

/**
 * Valid state transitions map.
 * Keys are current states, values are allowed target states.
 */
const VALID_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  discovered: new Set(["installed"]),
  installed: new Set(["enabled", "uninstalled"]),
  enabled: new Set(["disabled"]),
  disabled: new Set(["enabled", "uninstalled"]),
};

/**
 * Service that manages plugin lifecycle state in memory.
 *
 * Does NOT depend on NestJS — uses plain TypeScript.
 * Enforces valid state transitions (e.g., can't enable an uninstalled plugin).
 */
export class PluginLifecycleService {
  /** In-memory state map: pluginId -> lifecycle state. */
  private readonly states = new Map<string, PluginLifecycleState>();

  /** Manifests indexed by pluginId for quick lookup during list(). */
  private readonly manifests = new Map<string, PluginManifestDiscoveryResult>();

  /**
   * Register discovered manifests so the service knows about available plugins.
   *
   * @param results - Manifest discovery results to seed the service with.
   */
  seedFromDiscovery(results: PluginManifestDiscoveryResult[]): void {
    for (const result of results) {
      const id = result.manifest.id;
      if (!id) {
        continue;
      }
      this.manifests.set(id, result);
      if (!this.states.has(id)) {
        this.states.set(id, "discovered");
      }
    }
  }

  /**
   * Install a plugin (discovered → installed).
   */
  install(pluginId: string): Promise<PluginLifecycleResponse> {
    return Promise.resolve(
      this.applyTransition(pluginId, "install", "installed"),
    );
  }

  /**
   * Enable a plugin (installed → enabled, or disabled → enabled).
   */
  enable(pluginId: string): Promise<PluginLifecycleResponse> {
    return Promise.resolve(this.applyTransition(pluginId, "enable", "enabled"));
  }

  /**
   * Disable an enabled plugin (enabled → disabled).
   */
  disable(pluginId: string): Promise<PluginLifecycleResponse> {
    return Promise.resolve(
      this.applyTransition(pluginId, "disable", "disabled"),
    );
  }

  /**
   * Uninstall a plugin (installed → uninstalled, or disabled → uninstalled).
   */
  uninstall(pluginId: string): Promise<PluginLifecycleResponse> {
    return Promise.resolve(
      this.applyTransition(pluginId, "uninstall", "uninstalled"),
    );
  }

  /**
   * List all known plugins with their current lifecycle state.
   */
  list(): PluginLifecycleListResponse {
    const plugins: PluginLifecycleListResponse["plugins"] = [];

    for (const [pluginId, state] of this.states) {
      const manifest = this.manifests.get(pluginId);
      plugins.push({
        pluginId,
        state,
        manifestRef: manifest?.manifestPath ?? "",
      });
    }

    return { plugins };
  }

  /**
   * Apply a lifecycle transition with validation.
   */
  private applyTransition(
    pluginId: string,
    operation: PluginLifecycleOperation,
    targetState: PluginLifecycleState,
  ): PluginLifecycleResponse {
    const current = this.states.get(pluginId);

    // Plugin not found
    if (current === undefined) {
      return {
        success: false,
        pluginId,
        operation,
        state: "unknown",
        error: `Plugin not found: ${pluginId}`,
      };
    }

    // Idempotent: already in the target state
    if (current === targetState) {
      return {
        success: true,
        pluginId,
        operation,
        state: current,
      };
    }

    // Validate transition
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed || !allowed.has(targetState)) {
      return {
        success: false,
        pluginId,
        operation,
        state: current,
        error: `Invalid state transition: cannot ${operation} a plugin in '${current}' state`,
      };
    }

    // Apply the transition
    this.states.set(pluginId, targetState);

    return {
      success: true,
      pluginId,
      operation,
      state: targetState,
    };
  }
}
