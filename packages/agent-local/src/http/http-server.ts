import http from "node:http";
import type { LocalAgentConfig } from "../config/config.types.js";
import type { JsonRpcRequest } from "../mcp/mcp.types.js";
import { McpRouter } from "../mcp/mcp-router.js";
import type { DiagnosticsSnapshot } from "../tools/tools.types.js";

type RuntimeState = {
  startupTime: string;
};

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return typeof value === "object" && value !== null;
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });

    req.on("end", () => {
      if (data.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data) as unknown);
      } catch {
        reject(new Error("Invalid JSON payload"));
      }
    });

    req.on("error", reject);
  });
}

function writeJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(body);
}

export function createHttpServer(
  config: LocalAgentConfig,
  router: McpRouter,
  diagnostics: () => DiagnosticsSnapshot,
): http.Server {
  const runtime: RuntimeState = {
    startupTime: new Date().toISOString(),
  };

  const handleRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    if (req.method === "GET" && req.url === "/health") {
      writeJson(res, 200, {
        status: "ok",
        version: "0.1.0",
      });
      return;
    }

    if (req.method === "GET" && req.url === "/diagnostics") {
      writeJson(res, 200, {
        ...diagnostics(),
        startupTime: runtime.startupTime,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/mcp") {
      try {
        const payload = await readJsonBody(req);
        if (!isJsonRpcRequest(payload)) {
          writeJson(res, 400, {
            jsonrpc: "2.0",
            error: {
              code: -32600,
              message: "Invalid Request",
            },
          });
          return;
        }

        const response = await router.handleRequest(payload);
        writeJson(res, 200, response);
        return;
      } catch (error) {
        writeJson(res, 400, {
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: error instanceof Error ? error.message : "Parse error",
          },
        });
        return;
      }
    }

    writeJson(res, 404, {
      status: "not_found",
      host: config.host,
      port: config.port,
    });
  };

  return http.createServer((req, res) => {
    void handleRequest(req, res);
  });
}
