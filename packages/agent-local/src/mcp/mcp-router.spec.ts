import { describe, expect, it, vi } from "vitest";
import { McpRouter } from "./mcp-router.js";

function createRouter() {
  const execTool = {
    execute: vi.fn(() =>
      Promise.resolve({ content: [{ type: "text", text: "ok" }] }),
    ),
  };

  const fileTools = {
    readFile: vi.fn(() =>
      Promise.resolve({ content: [{ type: "text", text: "read" }] }),
    ),
    writeFile: vi.fn(() =>
      Promise.resolve({ content: [{ type: "text", text: "write" }] }),
    ),
    listDir: vi.fn(() =>
      Promise.resolve({ content: [{ type: "text", text: "list" }] }),
    ),
    delete: vi.fn(() =>
      Promise.resolve({ content: [{ type: "text", text: "delete" }] }),
    ),
  };

  return {
    router: new McpRouter(execTool as never, fileTools as never),
    execTool,
    fileTools,
  };
}

describe("McpRouter", () => {
  it("responds to initialize", async () => {
    const { router } = createRouter();

    const response = await router.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
  });

  it("responds to tools/list", async () => {
    const { router } = createRouter();

    const response = await router.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    const result = response.result as { tools: unknown[] };
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools.length).toBeGreaterThan(0);
  });

  it("dispatches exec tool calls", async () => {
    const { router, execTool } = createRouter();

    const response = await router.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "exec",
        arguments: {
          command: "npm",
          args: ["test"],
        },
      },
    });

    expect(response.error).toBeUndefined();
    expect(execTool.execute).toHaveBeenCalledTimes(1);
  });
});
