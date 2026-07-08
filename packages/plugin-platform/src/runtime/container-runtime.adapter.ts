import { execFile, execSync } from "node:child_process";
import type {
  RuntimeAdapter,
  RuntimeAdapterConfig,
  RuntimeAdapterHealth,
  RuntimeIsolationMode,
} from "./runtime-adapter.types";

/** Result from `docker inspect` for a single container. */
type DockerInspectJson = Array<{ State: { Status: string } }>;

/** Regex patterns for input validation. */
const VALID_IMAGE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._/\-:@]+$/;
const VALID_CONTAINER_ID = /^[a-zA-Z0-9]+$/;
const VALID_ENV_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * OCI container runtime adapter for the 'container' isolation mode.
 *
 * This adapter handles container lifecycle operations (create, start, stop,
 * remove, status) and provides health checks for the Docker runtime.
 */
export class ContainerRuntimeAdapter implements RuntimeAdapter {
  private containerImage: string | undefined;
  private env: Readonly<Record<string, string>> = {};

  // ── Input validation helpers ──────────────────────────────────────────

  private static validateImageName(image: string): void {
    if (!image || typeof image !== "string") {
      throw new Error("Invalid image name: must be a non-empty string");
    }
    if (!VALID_IMAGE_NAME.test(image)) {
      throw new Error(
        `Invalid image name "${image}": contains disallowed characters`,
      );
    }
  }

  private static validateContainerId(containerId: string): void {
    if (!containerId || typeof containerId !== "string") {
      throw new Error("Invalid container ID: must be a non-empty string");
    }
    if (!VALID_CONTAINER_ID.test(containerId)) {
      throw new Error(
        `Invalid container ID "${containerId}": must be alphanumeric`,
      );
    }
  }

  private static validateEnvKey(key: string): void {
    if (!VALID_ENV_KEY.test(key)) {
      throw new Error(
        `Invalid environment variable name "${key}": must match ${VALID_ENV_KEY.source}`,
      );
    }
  }

  // ── Docker availability check ─────────────────────────────────────────

  /**
   * Check that the Docker CLI is available.  Throws if not.
   */
  private static async ensureDockerAvailable(): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile("command", ["-v", "docker"], (error, stdout) => {
        if (error || !stdout.trim()) {
          reject(
            new Error("Docker CLI is not available — is Docker installed?"),
          );
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Wrap an `execFile` call and return a promise that resolves with trimmed
   * stdout or rejects with a human-readable error.
   */
  private static execDocker(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("docker", args, (error, stdout, stderr) => {
        if (error) {
          const detail = stderr ? stderr.trim() : error.message;
          reject(new Error(`docker ${args[0]} failed: ${detail}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  // ── RuntimeAdapter interface ──────────────────────────────────────────

  /**
   * Apply runtime configuration.
   */
  configure(config: RuntimeAdapterConfig): void {
    this.containerImage = config.containerImage;
    this.env = config.env ?? {};
  }

  /**
   * Check whether the local OCI runtime (Docker) is available.
   */
  getHealth(): RuntimeAdapterHealth {
    const runtimeAvailable = this.isOciRuntimeAvailable();

    if (runtimeAvailable) {
      return {
        healthy: true,
        mode: "container",
        details: "OCI runtime (Docker) available",
      };
    }

    return {
      healthy: false,
      mode: "container",
      details:
        "OCI runtime (Docker) not found — container isolation unavailable",
    };
  }

  /** Always returns 'container'. */
  getMode(): RuntimeIsolationMode {
    return "container";
  }

  // ── Container lifecycle methods ───────────────────────────────────────

  /**
   * Create a Docker container from the given image.
   *
   * @returns The container ID of the newly created container.
   */
  async createContainer(
    image: string,
    options?: {
      env?: Record<string, string>;
      ports?: Record<string, string>;
      volumes?: Array<{ host: string; container: string }>;
    },
  ): Promise<string> {
    ContainerRuntimeAdapter.validateImageName(image);
    await ContainerRuntimeAdapter.ensureDockerAvailable();

    const args = ["create"];

    // Environment variables
    if (options?.env) {
      for (const [key, value] of Object.entries(options.env)) {
        ContainerRuntimeAdapter.validateEnvKey(key);
        args.push("-e", `${key}=${value}`);
      }
    }

    // Port mappings
    if (options?.ports) {
      for (const [host, container] of Object.entries(options.ports)) {
        args.push("-p", `${host}:${container}`);
      }
    }

    // Volume mounts
    if (options?.volumes) {
      for (const vol of options.volumes) {
        args.push("-v", `${vol.host}:${vol.container}`);
      }
    }

    args.push(image);

    const containerId = await ContainerRuntimeAdapter.execDocker(args);
    return containerId;
  }

  /**
   * Start a Docker container by ID.
   */
  async startContainer(containerId: string): Promise<void> {
    ContainerRuntimeAdapter.validateContainerId(containerId);
    await ContainerRuntimeAdapter.ensureDockerAvailable();

    await ContainerRuntimeAdapter.execDocker(["start", containerId]);
  }

  /**
   * Stop a Docker container by ID.
   */
  async stopContainer(containerId: string): Promise<void> {
    ContainerRuntimeAdapter.validateContainerId(containerId);
    await ContainerRuntimeAdapter.ensureDockerAvailable();

    await ContainerRuntimeAdapter.execDocker(["stop", containerId]);
  }

  /**
   * Remove a Docker container by ID.
   */
  async removeContainer(containerId: string): Promise<void> {
    ContainerRuntimeAdapter.validateContainerId(containerId);
    await ContainerRuntimeAdapter.ensureDockerAvailable();

    await ContainerRuntimeAdapter.execDocker(["rm", containerId]);
  }

  /**
   * Get the current status of a Docker container.
   *
   * @returns One of `'running'`, `'exited'`, `'created'`, or `'unknown'`.
   */
  async getContainerStatus(
    containerId: string,
  ): Promise<"running" | "exited" | "created" | "unknown"> {
    ContainerRuntimeAdapter.validateContainerId(containerId);
    await ContainerRuntimeAdapter.ensureDockerAvailable();

    const stdout = await ContainerRuntimeAdapter.execDocker([
      "inspect",
      "--format",
      "{{json .}}",
      containerId,
    ]);

    try {
      const parsed: DockerInspectJson = JSON.parse(stdout) as DockerInspectJson;
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return "unknown";
      }

      const status = parsed[0]?.State?.Status;
      switch (status) {
        case "running":
        case "exited":
        case "created":
          return status;
        default:
          return "unknown";
      }
    } catch {
      return "unknown";
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /**
   * Probe the local environment for a working Docker installation (sync).
   */
  private isOciRuntimeAvailable(): boolean {
    try {
      execSync("command -v docker", { stdio: "ignore" });
      return true;
    } catch {
      // `docker` CLI not found; check for the socket
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      return fs.existsSync("/var/run/docker.sock");
    } catch {
      return false;
    }
  }
}
