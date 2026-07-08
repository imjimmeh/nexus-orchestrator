import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContainerRuntimeAdapter } from "./container-runtime.adapter";
import type {
  RuntimeAdapterConfig,
  RuntimeAdapterHealth,
} from "./runtime-adapter.types";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFile: vi.fn(),
}));

describe("ContainerRuntimeAdapter", () => {
  let adapter: ContainerRuntimeAdapter;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const { execSync } = await import("node:child_process");
    vi.mocked(execSync).mockReturnValue(Buffer.from(""));
    adapter = new ContainerRuntimeAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Existing tests (regression) ─────────────────────────────────────

  describe("configure", () => {
    it("stores the container image from config", () => {
      const config: RuntimeAdapterConfig = {
        mode: "container",
        containerImage: "docker.io/library/my-plugin:latest",
      };

      adapter.configure(config);

      // configure stores the image internally; verify it doesn't throw
      expect(() => adapter.getHealth()).not.toThrow();
    });

    it("stores environment variables from config", () => {
      const config: RuntimeAdapterConfig = {
        mode: "container",
        containerImage: "docker.io/library/test:1.0",
        env: { NODE_ENV: "production", DEBUG: "plugin:*" },
      };

      adapter.configure(config);

      // configure stores env internally; verify it doesn't throw
      expect(() => adapter.getHealth()).not.toThrow();
    });

    it("defaults env to empty object when not provided", () => {
      const config: RuntimeAdapterConfig = {
        mode: "container",
        containerImage: "some-image",
      };

      // Should not throw when env is undefined
      expect(() => {
        adapter.configure(config);
      }).not.toThrow();
    });
  });

  describe("getHealth", () => {
    it("returns healthy when Docker CLI is available", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockReturnValue(Buffer.from(""));

      const freshAdapter = new ContainerRuntimeAdapter();

      const config: RuntimeAdapterConfig = {
        mode: "container",
        containerImage: "test-image",
      };
      freshAdapter.configure(config);

      const health = freshAdapter.getHealth();

      expect(health).toEqual<RuntimeAdapterHealth>({
        healthy: true,
        mode: "container",
        details: "OCI runtime (Docker) available",
      });
      expect(execSync).toHaveBeenCalledWith(
        "command -v docker",
        expect.anything(),
      );
    });

    it("returns degraded when Docker CLI is unavailable and socket is missing", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("command not found");
      });

      const freshAdapter = new ContainerRuntimeAdapter();

      const config: RuntimeAdapterConfig = {
        mode: "container",
        containerImage: "test-image",
      };
      freshAdapter.configure(config);

      const health = freshAdapter.getHealth();

      expect(health.healthy).toBe(false);
      expect(health.mode).toBe("container");
      expect(health.details).toContain("not found");
    });
  });

  describe("getMode", () => {
    it("always returns container", () => {
      expect(adapter.getMode()).toBe("container");
    });

    it("returns container even when Docker is unavailable", async () => {
      const { execSync } = await import("node:child_process");
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      const freshAdapter = new ContainerRuntimeAdapter();

      expect(freshAdapter.getMode()).toBe("container");
    });
  });

  // ── New tests: container lifecycle methods ──────────────────────────

  describe("createContainer", () => {
    it("rejects when Docker CLI is not available", async () => {
      const { execFile } = await import("node:child_process");

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null) => void,
        ) => {
          callback(new Error("command not found"));
        },
      );

      await expect(adapter.createContainer("my-image:latest")).rejects.toThrow(
        /Docker CLI is not available/,
      );
    });

    it("rejects for invalid image names (empty string)", async () => {
      await expect(adapter.createContainer("")).rejects.toThrow(
        /Invalid image name/,
      );
    });

    it("rejects for invalid image names (special characters)", async () => {
      await expect(
        adapter.createContainer("bad;image$(whoami)"),
      ).rejects.toThrow(/Invalid image name/);
    });

    it("rejects for invalid image names (spaces)", async () => {
      await expect(adapter.createContainer("bad image name")).rejects.toThrow(
        /Invalid image name/,
      );
    });

    it("resolves with container ID when Docker is available", async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker");
            return;
          }
          callback(null, "abc123def456");
        },
      );

      const containerId = await adapter.createContainer("my-image:latest");
      expect(containerId).toBe("abc123def456");
    });

    it("passes environment variables to docker create", async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;
      let createArgs: string[] = [];

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          args: string[],
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker");
            return;
          }
          createArgs = args;
          callback(null, "container123");
        },
      );

      await adapter.createContainer("my-image:latest", {
        env: { NODE_ENV: "production", DEBUG: "1" },
      });

      expect(createArgs).toContain("-e");
      expect(createArgs).toContain("NODE_ENV=production");
      expect(createArgs).toContain("DEBUG=1");
    });

    it("passes port mappings to docker create", async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;
      let createArgs: string[] = [];

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          args: string[],
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker");
            return;
          }
          createArgs = args;
          callback(null, "container123");
        },
      );

      await adapter.createContainer("my-image:latest", {
        ports: { "8080": "8080", "9090": "9090" },
      });

      expect(createArgs).toContain("-p");
      expect(createArgs).toContain("8080:8080");
      expect(createArgs).toContain("9090:9090");
    });

    it("passes volume mounts to docker create", async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;
      let createArgs: string[] = [];

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          args: string[],
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker");
            return;
          }
          createArgs = args;
          callback(null, "container123");
        },
      );

      await adapter.createContainer("my-image:latest", {
        volumes: [{ host: "/host/path", container: "/container/path" }],
      });

      expect(createArgs).toContain("-v");
      expect(createArgs).toContain("/host/path:/container/path");
    });

    it("rejects invalid env keys", async () => {
      const { execFile } = await import("node:child_process");

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callback(null, "/usr/bin/docker");
        },
      );

      await expect(
        adapter.createContainer("my-image:latest", {
          env: { "INVALID KEY!": "value" },
        }),
      ).rejects.toThrow(/Invalid environment variable name/);
    });

    it("rejects when docker create command fails", async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker", "");
            return;
          }
          const err = new Error("command failed");

          (err as any).code = 1;
          callback(err, "", "No such image: my-image:latest");
        },
      );

      await expect(adapter.createContainer("my-image:latest")).rejects.toThrow(
        /docker create failed/,
      );
    });
  });

  describe("startContainer", () => {
    it("rejects when Docker CLI is not available", async () => {
      const { execFile } = await import("node:child_process");

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null) => void,
        ) => {
          callback(new Error("command not found"));
        },
      );

      await expect(adapter.startContainer("abc123")).rejects.toThrow(
        /Docker CLI is not available/,
      );
    });

    it("rejects for invalid container ID", async () => {
      await expect(adapter.startContainer("invalid;id")).rejects.toThrow(
        /Invalid container ID/,
      );
    });

    it("rejects for empty container ID", async () => {
      await expect(adapter.startContainer("")).rejects.toThrow(
        /Invalid container ID/,
      );
    });

    it("resolves successfully when Docker starts the container", async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker");
            return;
          }
          callback(null, "abc123");
        },
      );

      await expect(adapter.startContainer("abc123")).resolves.toBeUndefined();
    });

    it("rejects on docker start failure", async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker", "");
            return;
          }
          const err = new Error("command failed");

          (err as any).code = 1;
          callback(err, "", "No such container: abc123");
        },
      );

      await expect(adapter.startContainer("abc123")).rejects.toThrow(
        /docker start failed/,
      );
    });
  });

  describe("stopContainer", () => {
    it("rejects for invalid container ID", async () => {
      await expect(adapter.stopContainer("invalid;id")).rejects.toThrow(
        /Invalid container ID/,
      );
    });

    it("resolves successfully when Docker stops the container", async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker");
            return;
          }
          callback(null, "abc123");
        },
      );

      await expect(adapter.stopContainer("abc123")).resolves.toBeUndefined();
    });

    it("rejects on docker stop failure", async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker", "");
            return;
          }
          const err = new Error("command failed");

          (err as any).code = 1;
          callback(err, "", "No such container: abc123");
        },
      );

      await expect(adapter.stopContainer("abc123")).rejects.toThrow(
        /docker stop failed/,
      );
    });
  });

  describe("removeContainer", () => {
    it("rejects for invalid container ID", async () => {
      await expect(adapter.removeContainer("invalid;id")).rejects.toThrow(
        /Invalid container ID/,
      );
    });

    it("resolves successfully when Docker removes the container", async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker");
            return;
          }
          callback(null, "abc123");
        },
      );

      await expect(adapter.removeContainer("abc123")).resolves.toBeUndefined();
    });

    it("rejects on docker rm failure", async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker", "");
            return;
          }
          const err = new Error("command failed");

          (err as any).code = 1;
          callback(err, "", "No such container: abc123");
        },
      );

      await expect(adapter.removeContainer("abc123")).rejects.toThrow(
        /docker rm failed/,
      );
    });
  });

  describe("getContainerStatus", () => {
    it("rejects for invalid container ID (special chars)", async () => {
      await expect(adapter.getContainerStatus("bad;id")).rejects.toThrow(
        /Invalid container ID/,
      );
    });

    it('returns "running" when docker inspect reports running', async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker");
            return;
          }
          callback(null, JSON.stringify([{ State: { Status: "running" } }]));
        },
      );

      await expect(adapter.getContainerStatus("abc123")).resolves.toBe(
        "running",
      );
    });

    it('returns "exited" when docker inspect reports exited', async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker");
            return;
          }
          callback(null, JSON.stringify([{ State: { Status: "exited" } }]));
        },
      );

      await expect(adapter.getContainerStatus("abc123")).resolves.toBe(
        "exited",
      );
    });

    it('returns "created" when docker inspect reports created', async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker");
            return;
          }
          callback(null, JSON.stringify([{ State: { Status: "created" } }]));
        },
      );

      await expect(adapter.getContainerStatus("abc123")).resolves.toBe(
        "created",
      );
    });

    it('returns "unknown" for an unrecognised status', async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker");
            return;
          }
          callback(null, JSON.stringify([{ State: { Status: "paused" } }]));
        },
      );

      await expect(adapter.getContainerStatus("abc123")).resolves.toBe(
        "unknown",
      );
    });

    it('returns "unknown" when inspect output is malformed', async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker");
            return;
          }
          callback(null, "not valid json");
        },
      );

      await expect(adapter.getContainerStatus("abc123")).resolves.toBe(
        "unknown",
      );
    });

    it('returns "unknown" when inspect returns empty array', async () => {
      const { execFile } = await import("node:child_process");
      let callCount = 0;

      (vi.mocked(execFile) as any).mockImplementation(
        (
          _file: string,
          _args: string[],
          callback: (err: Error | null, stdout: string) => void,
        ) => {
          callCount++;
          if (callCount === 1) {
            callback(null, "/usr/bin/docker");
            return;
          }
          callback(null, "[]");
        },
      );

      await expect(adapter.getContainerStatus("abc123")).resolves.toBe(
        "unknown",
      );
    });
  });
});
