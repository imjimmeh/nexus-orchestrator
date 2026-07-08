import { Injectable } from "@nestjs/common";
import { WorkItemService } from "../work-item/work-item.service";

@Injectable()
export class ReviewService {
  constructor(private readonly workItems: WorkItemService) {}

  async recordDecision(params: {
    project_id: string;
    workItemId: string;
    decision: "approve" | "reject";
    workflowId: string;
    requestedBy?: string;
  }) {
    return this.workItems.submitReviewDecision(
      params.project_id,
      params.workItemId,
      {
        decision: params.decision,
        workflowId: params.workflowId,
        requestedBy: params.requestedBy,
      },
    );
  }
}
