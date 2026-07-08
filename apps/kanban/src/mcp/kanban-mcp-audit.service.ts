import { Injectable, Logger } from "@nestjs/common";
import type { KanbanMcpAuditEntry } from "./kanban-mcp.types";

@Injectable()
export class KanbanMcpAuditService {
  private readonly logger = new Logger(KanbanMcpAuditService.name);
  readonly entries: KanbanMcpAuditEntry[] = [];

  record(entry: KanbanMcpAuditEntry): void {
    this.entries.push(entry);
    this.logger.log(
      `${entry.eventName}: tool=${entry.toolName} correlation=${entry.correlationId ?? "none"} run=${entry.workflowRunId ?? "none"}`,
    );
  }
}
