import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
} from "@nestjs/common";
import { ReviewService } from "./review.service";

type ReviewDecisionBody = {
  decision?: "approve" | "reject";
  workflow_id?: string;
  requested_by?: string;
};

@Controller("projects/:project_id/reviews")
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Post("work-items/:workItemId/decision")
  async recordDecision(
    @Param("project_id") project_id: string,
    @Param("workItemId") workItemId: string,
    @Body() body: ReviewDecisionBody,
  ) {
    const decision = body.decision;
    if (!decision) {
      throw new BadRequestException("decision is required");
    }

    const workflowId = this.requireString(body.workflow_id, "workflow_id");
    const data = await this.reviews.recordDecision({
      project_id,
      workItemId,
      decision,
      workflowId,
      requestedBy: body.requested_by,
    });
    return { success: true, data };
  }

  private requireString(value: string | undefined, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required`);
    }

    return value.trim();
  }
}
