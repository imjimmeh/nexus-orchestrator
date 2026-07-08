import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer } from "./http-server.js";
import { McpRouter } from "../mcp/mcp-router.js";

const servers: http.Server[] = [];

async function startServer(): Promise<{
  server: http.Server;
  baseUrl: string;
}> {
  const router = new McpRouter(
    {
      execute: () =>
        Promise.resolve({ content: [{ type: "text", text: "ok" }] }),
    } as never,
    {
      readFile: () =>
        Promise.resolve({ content: [{ type: "text", text: "read" }] }),
      writeFile: () =>
        Promise.resolve({ content: [{ type: "text", text: "write" }] }),
      listDir: () =>
        Promise.resolve({ content: [{ type: "text", text: "list" }] }),
      delete: () =>
        Promise.resolve({ content: [{ type: "text", text: "delete" }] }),
    } as never,
  );

  const server = createHttpServer(
    {
      host: "127.0.0.1",
      port: 0,
      allowedRoots: [],
      allowPatterns: [],
      defaultCommandTimeoutMs: 30000,
      maxFileBytes: 1000,
      logToStdout: false,
    },
    router,
    () => ({
      config: {},
      tools: ["exec"],
      startupTime: new Date().toISOString(),
    }),
  );

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  servers.push(server);
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve test server address");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

describe("createHttpServer", () => {
  it("returns health response", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("accepts mcp initialize", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { result?: unknown };
    expect(body.result).toBeDefined();
  });
});
