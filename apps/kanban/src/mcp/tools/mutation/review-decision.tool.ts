import { Injectable } from "@nestjs/common";
import type {
  InternalToolExecutionContext,
} from "@nexus/core";
import { KanbanTool } from "../kanban-tool";
import { ReviewService } from "../../../review/review.service";
import { ReviewDecisionSchema } from "../shared/schemas";

interface ReviewDecisionParams {
  project_id: string;
  workItemId: string;
  decision: "approve" | "reject";
  workflowId: string;
  requestedBy?: string;
}

@Injectable()
export class ReviewDecisionTool extends KanbanTool<
  ReviewDecisionParams,
  { ok: true }
> {
  constructor(private readonly review: ReviewService) {
    super("kanban.review_decision", {
      name: "kanban.review_decision",
      description: "Submit a kanban work item review decision.",
      inputSchema: ReviewDecisionSchema,
      tierRestriction: 2,
      transport: "runner_local" as const,
      runtimeOwner: "runner" as const,
    });
  }

  protected async run(
    _context: InternalToolExecutionContext,
    params: ReviewDecisionParams,
  ): Promise<{ ok: true }> {
    await this.review.recordDecision({
      project_id: params.project_id,
      workItemId: params.workItemId,
      decision: params.decision,
      workflowId: params.workflowId,
      requestedBy: params.requestedBy,
    });
    return { ok: true };
  }
}
