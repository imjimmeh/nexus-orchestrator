import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  McpRemoteTool,
  stripJsonSchemaMeta,
  type IInternalToolHandler,
  type InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanMcpAuditService } from "./kanban-mcp-audit.service";
import { KanbanMcpCallContext } from "./kanban-mcp.types";
import { KANBAN_INTERNAL_TOOL_HANDLER } from "./tools/shared/tokens";

@Injectable()
export class KanbanMcpService {
  constructor(
    @Inject(KANBAN_INTERNAL_TOOL_HANDLER)
    private readonly tools: IInternalToolHandler[],
    private readonly audit: KanbanMcpAuditService,
  ) {}

  listTools(): McpRemoteTool[] {
    return this.tools.map((tool) => {
      const schema = tool.getDefinition().inputSchema.toJSONSchema();
      return {
        name: tool.getName(),
        description: tool.getDefinition().description ?? "",
        inputSchema: stripJsonSchemaMeta(schema),
      };
    });
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    context: KanbanMcpCallContext,
  ): Promise<unknown> {
    const tool = this.tools.find((t) => t.getName() === toolName);
    if (!tool) {
      throw new BadRequestException(`Unknown kanban MCP tool ${toolName}`);
    }

    const internalContext: InternalToolExecutionContext = {
      workflowRunId: context.workflowRunId ?? undefined,
      jobId: context.jobId ?? undefined,
      // x-scope-id is the canonical header; fall back to x-correlation-id because
      // the current pi-runner dist sends payload.scopeId via x-correlation-id
      scopeId: context.scopeId ?? context.correlationId ?? undefined,
    };

    try {
      const definition = tool.getDefinition();
      const parsedArgs = definition.inputSchema.safeParse(args);
      if (!parsedArgs.success) {
        throw new BadRequestException(
          `Invalid arguments for kanban MCP tool ${toolName}`,
        );
      }

      const result = await tool.execute(internalContext, parsedArgs.data);
      this.audit.record({
        eventName: "kanban.mcp.tool.succeeded",
        toolName,
        correlationId: context.correlationId ?? null,
        workflowRunId: context.workflowRunId ?? null,
      });
      return result;
    } catch (error) {
      this.audit.record({
        eventName: "kanban.mcp.tool.failed",
        toolName,
        correlationId: context.correlationId ?? null,
        workflowRunId: context.workflowRunId ?? null,
        errorMessage:
          error instanceof Error ? error.message : "Unknown MCP error",
      });
      throw error;
    }
  }
}
