import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { JsonRpcRequest } from "@nexus/core";
import { InternalServiceScopes } from "../common/internal-service-scopes.decorator";
import { InternalServiceAuthGuard } from "../common/internal-service-auth.guard";
import { KanbanMcpService } from "./kanban-mcp.service";

@Controller("mcp")
@UseGuards(InternalServiceAuthGuard)
@InternalServiceScopes("kanban:mcp")
export class KanbanMcpController {
  constructor(private readonly mcp: KanbanMcpService) {}

  @Post()
  async handleJsonRpc(@Body() body: JsonRpcRequest, @Req() request: Request) {
    const id = body.id ?? null;
    try {
      switch (body.method) {
        case "initialize":
          return this.result(id, {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "nexus-kanban", version: "0.0.1" },
          });
        case "notifications/initialized":
          return this.result(id, {});
        case "tools/list":
          return this.result(id, { tools: this.mcp.listTools() });
        case "tools/call":
          return this.result(
            id,
            await this.mcp.callTool(
              this.requireToolName(body.params),
              this.readArguments(body.params),
              this.readCallContext(request),
            ),
          );
        default:
          return this.error(
            id,
            -32601,
            `Unsupported MCP method ${body.method ?? "unknown"}`,
          );
      }
    } catch (error) {
      return this.error(
        id,
        -32000,
        error instanceof Error ? error.message : "Unknown MCP error",
      );
    }
  }

  private result(id: JsonRpcRequest["id"], result: unknown) {
    return { jsonrpc: "2.0", id, result };
  }

  private error(id: JsonRpcRequest["id"], code: number, message: string) {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }

  private requireToolName(params: Record<string, unknown> | undefined): string {
    const name = params?.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error("MCP tools/call requires params.name");
    }
    return name.trim();
  }

  private readArguments(
    params: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const args = params?.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return {};
    }
    return args as Record<string, unknown>;
  }

  private readHeader(request: Request, name: string): string | null {
    const value = request.headers[name];
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private readCallContext(request: Request) {
    const jobId = this.readHeader(request, "x-job-id");
    const stepId = this.readHeader(request, "x-step-id");
    const scopeId = this.readHeader(request, "x-scope-id");
    return {
      correlationId: this.readHeader(request, "x-correlation-id"),
      workflowRunId: this.readHeader(request, "x-workflow-run-id"),
      ...(jobId ? { jobId } : {}),
      ...(stepId ? { stepId } : {}),
      ...(scopeId ? { scopeId } : {}),
    };
  }
}
