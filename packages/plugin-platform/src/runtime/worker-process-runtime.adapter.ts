import type {
  RuntimeAdapter,
  RuntimeAdapterConfig,
  RuntimeAdapterHealth,
  RuntimeIsolationMode,
} from "./runtime-adapter.types";

/**
 * Worker process runtime adapter for the 'worker_process' isolation mode.
 *
 * This adapter is an intentional stub that reports `degraded` / unavailable.
 * Full worker process IPC is a kernel-level feature and is not available
 * in the standalone plugin platform. The adapter stores configuration and
 * exposes health checks so that consumers can detect at runtime that
 * worker_process isolation requires the plugin kernel.
 *
 * Follows the same pattern as `ContainerRuntimeAdapter` (config-only stub).
 */
export class WorkerProcessRuntimeAdapter implements RuntimeAdapter {
  private workerScript: string | undefined;
  private env: Readonly<Record<string, string>> = {};

  /**
   * Apply runtime configuration.
   *
   * Stores the worker script path and environment variables for potential
   * use by the plugin kernel when spawning worker-process-isolated plugins.
   */
  configure(config: RuntimeAdapterConfig): void {
    this.workerScript = config.workerScript;
    this.env = config.env ?? {};
  }

  /**
   * Report the health of the worker process runtime.
   *
   * Always returns `degraded` with `available: false` because worker
   * process support is not yet available in the standalone platform.
   */
  getHealth(): RuntimeAdapterHealth {
    return {
      healthy: false,
      mode: "worker_process",
      details:
        "Worker process runtime is deferred to the plugin kernel — not available in standalone platform",
    };
  }

  /**
   * Always returns 'worker_process'.
   */
  getMode(): RuntimeIsolationMode {
    return "worker_process";
  }
}
