import type { CommandExecutionInput } from "../config/config.types.js";
import { ExecTool } from "../tools/exec.tool.js";
import { FileTools } from "../tools/file-tools.js";
import type {
  JsonRpcError,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./mcp.types.js";
import { getToolSchemas } from "./tool-registry.js";

function responseError(
  id: JsonRpcRequest["id"],
  error: JsonRpcError,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error,
  };
}

function responseResult(
  id: JsonRpcRequest["id"],
  result: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readOptionalString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function readOptionalBoolean(
  source: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalNumber(
  source: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = source[key];
  return typeof value === "number" ? value : undefined;
}

export class McpRouter {
  constructor(
    private readonly execTool: ExecTool,
    private readonly fileTools: FileTools,
  ) {}

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (request.jsonrpc !== "2.0") {
      return responseError(request.id, {
        code: -32600,
        message: "Invalid Request",
      });
    }

    if (request.method === "initialize") {
      return responseResult(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "nexus-agent-local",
          version: "0.1.0",
        },
      });
    }

    if (request.method === "notifications/initialized") {
      return responseResult(request.id, {});
    }

    if (request.method === "tools/list") {
      return responseResult(request.id, {
        tools: getToolSchemas(),
      });
    }

    if (request.method !== "tools/call") {
      return responseError(request.id, {
        code: -32601,
        message: "Method not found",
      });
    }

    const params = request.params;
    if (!isRecord(params)) {
      return responseError(request.id, {
        code: -32602,
        message: "Invalid params",
      });
    }

    const name = params.name;
    const argumentsValue = params.arguments;

    if (typeof name !== "string" || !isRecord(argumentsValue)) {
      return responseError(request.id, {
        code: -32602,
        message: "Invalid tool call payload",
      });
    }

    try {
      const toolResult = await this.invokeTool(name, argumentsValue);
      return responseResult(request.id, toolResult);
    } catch (error) {
      return responseError(request.id, {
        code: -32000,
        message:
          error instanceof Error ? error.message : "Tool invocation failed",
      });
    }
  }

  private async invokeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (name === "exec") {
      return this.execTool.execute({
        command: readOptionalString(args, "command") ?? "",
        args: Array.isArray(args.args)
          ? args.args.filter(
              (entry): entry is string => typeof entry === "string",
            )
          : undefined,
        cwd: readOptionalString(args, "cwd"),
        timeout: readOptionalNumber(args, "timeout"),
      } satisfies CommandExecutionInput);
    }

    if (name === "read_file") {
      return this.invokeReadFile(args);
    }

    if (name === "write_file") {
      return this.invokeWriteFile(args);
    }

    if (name === "ls") {
      return this.invokeLs(args);
    }

    if (name === "delete") {
      return this.invokeDelete(args);
    }

    throw new Error(`Unknown tool: ${name}`);
  }

  private invokeReadFile(args: Record<string, unknown>): Promise<unknown> {
    const encoding = readOptionalString(args, "encoding");
    return this.fileTools.readFile({
      path: readOptionalString(args, "path") ?? "",
      encoding:
        encoding === "base64" || encoding === "utf8" ? encoding : undefined,
    });
  }

  private invokeWriteFile(args: Record<string, unknown>): Promise<unknown> {
    return this.fileTools.writeFile({
      path: readOptionalString(args, "path") ?? "",
      content: readOptionalString(args, "content") ?? "",
      mode: readOptionalNumber(args, "mode"),
    });
  }

  private invokeLs(args: Record<string, unknown>): Promise<unknown> {
    return this.fileTools.ls({
      path: readOptionalString(args, "path") ?? "",
      recursive: readOptionalBoolean(args, "recursive") ?? false,
      missing_ok: readOptionalBoolean(args, "missing_ok") ?? false,
    });
  }

  private invokeDelete(args: Record<string, unknown>): Promise<unknown> {
    return this.fileTools.delete({
      path: readOptionalString(args, "path") ?? "",
      recursive: readOptionalBoolean(args, "recursive") ?? false,
    });
  }
}
