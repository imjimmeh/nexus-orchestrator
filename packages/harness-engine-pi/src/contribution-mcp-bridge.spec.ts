/**
 * contribution-mcp-bridge — descriptor-driven MCP bridge governance tests.
 *
 * Verifies that:
 * 1. Each tool produced by `bridgeMcpServersToGovernedTools` is wrapped with
 *    governance (denied permission = soft `permission_denied` result, callTool
 *    NEVER invoked).
 * 2. Allowed permission proxies through to `callTool`.
 * 3. Empty descriptor list ⇒ `{ tools: [], dispose }` (byte-identical to stub).
 * 4. `dispose` closes every connected client handle.
 * 5. A mid-loop connect failure disposes already-opened handles (no leak).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResolvedMcpServerDescriptor } from "@nexus/core";
import type { CheckPermission } from "@nexus/harness-runtime";
import type {
  McpBridgeDeps,
  McpClientHandle,
} from "./contribution-mcp-bridge.types.js";
import { bridgeMcpServersToGovernedTools } from "./contribution-mcp-bridge.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDescriptor(
  overrides: Partial<ResolvedMcpServerDescriptor> = {},
): ResolvedMcpServerDescriptor {
  return {
    id: "server-1",
    name: "test-server",
    transportType: "http",
    url: "http://mcp.local:3100",
    timeoutMs: 30000,
    connectTimeoutMs: 10000,
    ...overrides,
  };
}

interface MockHandle {
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function makeHandle(toolNames: string[] = ["do_thing"]): MockHandle {
  return {
    listTools: vi.fn(async () =>
      toolNames.map((name) => ({
        name,
        description: `Tool ${name}`,
        inputSchema: { type: "object" as const, properties: {} },
      })),
    ),
    callTool: vi.fn(async () => ({ content: "ok" })),
    close: vi.fn(async () => undefined),
  };
}

const allowAll: CheckPermission = async () => ({ status: "allowed" });
const denyAll: CheckPermission = async () => ({
  status: "denied",
  reason: "policy",
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bridgeMcpServersToGovernedTools", () => {
  describe("governance (security-critical)", () => {
    it("denied permission returns soft permission_denied and does NOT call the tool", async () => {
      const handle = makeHandle(["secret_action"]);
      const deps: McpBridgeDeps = {
        connect: vi.fn(async () => handle),
      };

      const bridged = await bridgeMcpServersToGovernedTools(
        [makeDescriptor()],
        denyAll,
        deps,
      );

      expect(bridged.tools).toHaveLength(1);
      const tool = bridged.tools[0];
      const result = (await tool.execute("c1", {})) as {
        details: { ok: boolean; error: string };
      };

      // Must be a soft denial — not a throw, not an execution.
      expect(result.details.ok).toBe(false);
      expect(result.details.error).toBe("permission_denied");
      // The inner MCP callTool MUST NOT have been invoked.
      expect(handle.callTool).not.toHaveBeenCalled();
    });

    it("allowed permission proxies through to callTool", async () => {
      const handle = makeHandle(["my_tool"]);
      const deps: McpBridgeDeps = { connect: vi.fn(async () => handle) };

      const bridged = await bridgeMcpServersToGovernedTools(
        [makeDescriptor()],
        allowAll,
        deps,
      );

      const tool = bridged.tools[0];
      await tool.execute("c1", { arg: "val" });

      expect(handle.callTool).toHaveBeenCalledWith("my_tool", { arg: "val" });
    });

    it("each tool is individually governed (denied tool cannot delegate to any allowed path)", async () => {
      const handle = makeHandle(["allowed_tool", "denied_tool"]);
      const { callTool } = handle;
      const deps: McpBridgeDeps = { connect: vi.fn(async () => handle) };

      // Deny only "denied_tool"
      const mixedPermission: CheckPermission = async (toolName) =>
        toolName.includes("denied")
          ? { status: "denied", reason: "policy" }
          : { status: "allowed" };

      const bridged = await bridgeMcpServersToGovernedTools(
        [makeDescriptor()],
        mixedPermission,
        deps,
      );

      const allowedTool = bridged.tools.find((t) =>
        t.name.includes("allowed"),
      )!;
      const deniedTool = bridged.tools.find((t) => t.name.includes("denied"))!;

      await allowedTool.execute("c1", {});
      const deniedResult = (await deniedTool.execute("c2", {})) as {
        details: { error: string };
      };

      expect(callTool).toHaveBeenCalledTimes(1);
      expect(deniedResult.details.error).toBe("permission_denied");
    });
  });

  describe("empty descriptors", () => {
    it("returns byte-identical empty bundle when descriptor list is empty", async () => {
      const connectFn = vi.fn();
      const deps: McpBridgeDeps = { connect: connectFn };

      const bridged = await bridgeMcpServersToGovernedTools([], allowAll, deps);

      expect(bridged.tools).toHaveLength(0);
      expect(typeof bridged.dispose).toBe("function");
      await expect(bridged.dispose()).resolves.toBeUndefined();
      // connect must never be called for empty list
      expect(connectFn).not.toHaveBeenCalled();
    });
  });

  describe("multiple servers", () => {
    it("collects tools from all servers and wraps each with governance", async () => {
      const handleA = makeHandle(["tool_a1", "tool_a2"]);
      const handleB = makeHandle(["tool_b1"]);
      let callCount = 0;
      const deps: McpBridgeDeps = {
        connect: vi.fn(async () => {
          callCount += 1;
          return callCount === 1 ? handleA : handleB;
        }),
      };

      const bridged = await bridgeMcpServersToGovernedTools(
        [makeDescriptor({ id: "s1" }), makeDescriptor({ id: "s2" })],
        allowAll,
        deps,
      );

      expect(bridged.tools).toHaveLength(3);
    });
  });

  describe("dispose", () => {
    it("dispose closes every connected handle", async () => {
      const handleA = makeHandle(["a"]);
      const handleB = makeHandle(["b"]);
      let callCount = 0;
      const deps: McpBridgeDeps = {
        connect: vi.fn(async () => {
          callCount += 1;
          return callCount === 1 ? handleA : handleB;
        }),
      };

      const bridged = await bridgeMcpServersToGovernedTools(
        [makeDescriptor({ id: "s1" }), makeDescriptor({ id: "s2" })],
        allowAll,
        deps,
      );

      await bridged.dispose();

      expect(handleA.close).toHaveBeenCalledOnce();
      expect(handleB.close).toHaveBeenCalledOnce();
    });

    it("dispose tolerates close() failures (no uncaught rejection)", async () => {
      const failingHandle = makeHandle();
      failingHandle.close.mockRejectedValue(new Error("close failed"));
      const deps: McpBridgeDeps = {
        connect: vi.fn(async () => failingHandle),
      };

      const bridged = await bridgeMcpServersToGovernedTools(
        [makeDescriptor()],
        allowAll,
        deps,
      );

      // Should not throw
      await expect(bridged.dispose()).resolves.toBeUndefined();
    });
  });

  describe("mid-loop connect failure", () => {
    it("disposes already-opened handles when a later connect throws (no leak)", async () => {
      const openedHandle = makeHandle(["safe_tool"]);
      let connectCount = 0;
      const deps: McpBridgeDeps = {
        connect: vi.fn(async () => {
          connectCount += 1;
          if (connectCount === 2) {
            throw new Error("second connect failed");
          }
          return openedHandle;
        }),
      };

      await expect(
        bridgeMcpServersToGovernedTools(
          [makeDescriptor({ id: "s1" }), makeDescriptor({ id: "s2" })],
          allowAll,
          deps,
        ),
      ).rejects.toThrow("second connect failed");

      // The first handle must have been closed to prevent a resource leak.
      expect(openedHandle.close).toHaveBeenCalledOnce();
    });
  });

  describe("descriptor-driven connect arguments", () => {
    it("passes the descriptor to deps.connect", async () => {
      const handle = makeHandle();
      const connect = vi.fn(async () => handle);
      const deps: McpBridgeDeps = { connect };

      const descriptor = makeDescriptor({
        id: "desc-id",
        name: "my-server",
        transportType: "stdio",
        command: "/usr/bin/tool",
        args: ["--mode", "mcp"],
      });

      await bridgeMcpServersToGovernedTools([descriptor], allowAll, deps);

      expect(connect).toHaveBeenCalledWith(descriptor);
    });
  });

  // -------------------------------------------------------------------------
  // Fix B: includeTools / excludeTools filtering
  // -------------------------------------------------------------------------

  describe("tool filtering (Fix B)", () => {
    it("excludeTools removes the named tool from the bridged set", async () => {
      const handle = makeHandle(["tool_x", "tool_y", "tool_z"]);
      const deps: McpBridgeDeps = { connect: vi.fn(async () => handle) };

      const bridged = await bridgeMcpServersToGovernedTools(
        [makeDescriptor({ excludeTools: ["tool_x"] })],
        allowAll,
        deps,
      );

      const names = bridged.tools.map((t) => t.name);
      expect(names).not.toContain("tool_x");
      expect(names).toContain("tool_y");
      expect(names).toContain("tool_z");
    });

    it("includeTools bridges only the listed tools", async () => {
      const handle = makeHandle(["alpha", "beta", "gamma"]);
      const deps: McpBridgeDeps = { connect: vi.fn(async () => handle) };

      const bridged = await bridgeMcpServersToGovernedTools(
        [makeDescriptor({ includeTools: ["beta"] })],
        allowAll,
        deps,
      );

      const names = bridged.tools.map((t) => t.name);
      expect(names).toEqual(["beta"]);
    });

    it("excludeTools is applied after includeTools when both are set", async () => {
      const handle = makeHandle(["a", "b", "c", "d"]);
      const deps: McpBridgeDeps = { connect: vi.fn(async () => handle) };

      const bridged = await bridgeMcpServersToGovernedTools(
        [
          makeDescriptor({
            includeTools: ["a", "b", "c"],
            excludeTools: ["b"],
          }),
        ],
        allowAll,
        deps,
      );

      const names = bridged.tools.map((t) => t.name);
      expect(names).toEqual(["a", "c"]);
    });

    it("undefined includeTools/excludeTools bridges all tools", async () => {
      const handle = makeHandle(["p", "q", "r"]);
      const deps: McpBridgeDeps = { connect: vi.fn(async () => handle) };

      const bridged = await bridgeMcpServersToGovernedTools(
        [makeDescriptor({ includeTools: undefined, excludeTools: undefined })],
        allowAll,
        deps,
      );

      const names = bridged.tools.map((t) => t.name);
      expect(names).toEqual(["p", "q", "r"]);
    });

    it("governance still wraps every surviving tool after filtering", async () => {
      const handle = makeHandle(["keep_me", "drop_me"]);
      const deps: McpBridgeDeps = { connect: vi.fn(async () => handle) };

      const bridged = await bridgeMcpServersToGovernedTools(
        [makeDescriptor({ excludeTools: ["drop_me"] })],
        denyAll,
        deps,
      );

      expect(bridged.tools).toHaveLength(1);
      const result = (await bridged.tools[0].execute("c1", {})) as {
        details: { ok: boolean; error: string };
      };
      // The surviving tool is still governance-wrapped (denyAll → denied).
      expect(result.details.error).toBe("permission_denied");
      expect(handle.callTool).not.toHaveBeenCalled();
    });
  });
});
