import type { IsolationMode } from "../plugin-platform.types";
import { ContainerRuntimeAdapter } from "./container-runtime.adapter";
import { NoneRuntimeAdapter } from "./none-runtime.adapter";
import { WorkerProcessRuntimeAdapter } from "./worker-process-runtime.adapter";
import type {
  RuntimeAdapter,
  RuntimeAdapterHealth,
} from "./runtime-adapter.types";

/**
 * Aggregates all available runtime adapters and selects the active one
 * based on the configured isolation mode.
 *
 * The manager is constructed with all known adapters and exposes a unified
 * interface for querying health and retrieving the active adapter.
 */
export class RuntimeManager {
  private readonly noneAdapter: NoneRuntimeAdapter;
  private readonly containerAdapter: ContainerRuntimeAdapter;
  private readonly workerProcessAdapter: WorkerProcessRuntimeAdapter;
  private activeMode: IsolationMode;

  constructor(isolationMode: IsolationMode) {
    this.noneAdapter = new NoneRuntimeAdapter();
    this.containerAdapter = new ContainerRuntimeAdapter();
    this.workerProcessAdapter = new WorkerProcessRuntimeAdapter();
    this.activeMode = isolationMode;
  }

  /**
   * Return the adapter that matches the currently configured isolation mode.
   */
  getActiveAdapter(): RuntimeAdapter {
    switch (this.activeMode) {
      case "container":
        return this.containerAdapter;
      case "worker_process":
        return this.workerProcessAdapter;
      case "none":
      default:
        return this.noneAdapter;
    }
  }

  /**
   * Delegate to the active adapter and return its health status.
   */
  getHealth(): RuntimeAdapterHealth {
    return this.getActiveAdapter().getHealth();
  }

  // ── Container lifecycle delegation ────────────────────────────────────

  /**
   * Create a Docker container from the given image.
   * Delegates to the container adapter when the active mode is `container`.
   */
  async createContainer(
    image: string,
    options?: {
      env?: Record<string, string>;
      ports?: Record<string, string>;
      volumes?: Array<{ host: string; container: string }>;
    },
  ): Promise<string> {
    if (this.activeMode !== "container") {
      throw new Error(
        `createContainer is only available in container mode (current: ${this.activeMode})`,
      );
    }
    return this.containerAdapter.createContainer(image, options);
  }

  /**
   * Start a Docker container by ID.
   * Delegates to the container adapter when the active mode is `container`.
   */
  async startContainer(containerId: string): Promise<void> {
    if (this.activeMode !== "container") {
      throw new Error(
        `startContainer is only available in container mode (current: ${this.activeMode})`,
      );
    }
    return this.containerAdapter.startContainer(containerId);
  }

  /**
   * Stop a Docker container by ID.
   * Delegates to the container adapter when the active mode is `container`.
   */
  async stopContainer(containerId: string): Promise<void> {
    if (this.activeMode !== "container") {
      throw new Error(
        `stopContainer is only available in container mode (current: ${this.activeMode})`,
      );
    }
    return this.containerAdapter.stopContainer(containerId);
  }

  /**
   * Remove a Docker container by ID.
   * Delegates to the container adapter when the active mode is `container`.
   */
  async removeContainer(containerId: string): Promise<void> {
    if (this.activeMode !== "container") {
      throw new Error(
        `removeContainer is only available in container mode (current: ${this.activeMode})`,
      );
    }
    return this.containerAdapter.removeContainer(containerId);
  }

  /**
   * Get the current status of a Docker container.
   * Delegates to the container adapter when the active mode is `container`.
   */
  async getContainerStatus(containerId: string): Promise<string> {
    if (this.activeMode !== "container") {
      throw new Error(
        `getContainerStatus is only available in container mode (current: ${this.activeMode})`,
      );
    }
    return this.containerAdapter.getContainerStatus(containerId);
  }
}
