/**
 * Sibling controller for the global `/orchestration/action-requests`
 * surface (cross-project action-request reads).
 *
 * Kept in its own file so the project-scoped
 * {@link OrchestrationController} can stay focused on
 * `/projects/:project_id/orchestration/...` routes and the
 * cross-project action-request endpoints can evolve independently.
 * The two controllers share the orchestration service and the
 * `?status=` query normalization helper exposed in
 * `orchestration.controller.helpers.ts`.
 */
import { Controller, Get, Query } from "@nestjs/common";
import { OrchestrationService } from "./orchestration.service";
import { toStatusFilter } from "./orchestration.controller.helpers";

@Controller("orchestration/action-requests")
export class OrchestrationActionRequestsController {
  constructor(private readonly orchestration: OrchestrationService) {}

  @Get()
  async list(@Query("status") status?: string) {
    return {
      success: true,
      data: await this.orchestration.listActionRequests(
        toStatusFilter(status),
      ),
    };
  }
}