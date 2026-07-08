/**
 * Runtime isolation modes supported by the plugin platform.
 * Mirrors the isolation modes defined in the plugin kernel.
 */
export type RuntimeIsolationMode = "none" | "worker_process" | "container";

/**
 * Configuration passed to a runtime adapter.
 */
export interface RuntimeAdapterConfig {
  /** The isolation mode this adapter should operate in. */
  readonly mode: RuntimeIsolationMode;
  /** OCI container image to use (applicable when mode is 'container'). */
  readonly containerImage?: string;
  /** Path to a worker script (applicable when mode is 'worker_process'). */
  readonly workerScript?: string;
  /** Environment variables to inject into the runtime. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Health status reported by a runtime adapter.
 */
export interface RuntimeAdapterHealth {
  /** Whether the adapter considers its runtime environment healthy. */
  readonly healthy: boolean;
  /** The isolation mode this adapter is configured for. */
  readonly mode: RuntimeIsolationMode;
  /** Optional human-readable details about the health status. */
  readonly details?: string;
}

/**
 * Interface that every runtime adapter must implement.
 *
 * A runtime adapter wires up the configuration and readiness checks for
 * a particular isolation mode. The actual process/container spawning is
 * handled at the kernel level — the adapter provides the platform-level
 * configuration and health wiring.
 */
export interface RuntimeAdapter {
  /** Apply configuration to the adapter. */
  configure(config: RuntimeAdapterConfig): void;

  /** Return the current health status of the runtime environment. */
  getHealth(): RuntimeAdapterHealth;

  /** Return the isolation mode this adapter represents. */
  getMode(): RuntimeIsolationMode;
}
