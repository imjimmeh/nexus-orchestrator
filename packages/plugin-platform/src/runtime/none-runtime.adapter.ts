import type {
  RuntimeAdapter,
  RuntimeAdapterConfig,
  RuntimeAdapterHealth,
  RuntimeIsolationMode,
} from "./runtime-adapter.types";

/**
 * No-op runtime adapter for the 'none' isolation mode.
 *
 * This adapter is a placeholder that always reports healthy. No actual
 * process or container isolation is applied when using this mode.
 */
export class NoneRuntimeAdapter implements RuntimeAdapter {
  /**
   * Configure is a no-op for the 'none' mode — there is nothing to set up.
   */
  configure(_config: RuntimeAdapterConfig): void {
    // No-op: the 'none' mode intentionally has no runtime configuration.
  }

  /**
   * The 'none' mode is always healthy because it requires no runtime infrastructure.
   */
  getHealth(): RuntimeAdapterHealth {
    return {
      healthy: true,
      mode: "none",
      details: "No-op runtime — always healthy",
    };
  }

  /**
   * Always returns 'none'.
   */
  getMode(): RuntimeIsolationMode {
    return "none";
  }
}
