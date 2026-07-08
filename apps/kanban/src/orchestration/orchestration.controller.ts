import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { WorkItemService } from "../work-item/work-item.service";
import {
  getOrchestrationOrNull,
  getProjectState,
  optionalString,
  requireString,
} from "./orchestration.controller.helpers";
import { OrchestrationPolicyService } from "./orchestration-policy.service";
import { OrchestrationService } from "./orchestration.service";
import { ProjectOrchestrationWakeupService } from "./project-orchestration-wakeup.service";
import type {
  ApproveActionBody,
  RecordDecisionBody,
  RejectActionBody,
  RequestActionBody,
  StartOrchestrationBody,
  TriggerCycleBody,
  UpdateOrchestrationModeBody,
} from "./orchestration.controller.types";

@Controller("projects/:project_id/orchestration")
export class OrchestrationController {
  constructor(
    private readonly orchestration: OrchestrationService,
    private readonly workItems: WorkItemService,
    private readonly wakeup: ProjectOrchestrationWakeupService,
    private readonly policy: OrchestrationPolicyService,
  ) {}

  @Post("start")
  async start(
    @Param("project_id") project_id: string,
    @Body() body: StartOrchestrationBody,
  ) {
    const goals = requireString(body.goals, "goals");
    const workflowId = optionalString(body.workflow_id);
    const data = await this.orchestration.start(project_id, {
      goals,
      workflowId,
      requestedBy: body.requested_by,
      orchestrationMode: body.orchestration_mode,
      sourceContext: body.source_context,
      readinessContext: body.readiness_context,
      startupHints: body.startup_hints,
    });
    return { success: true, data };
  }

  @Get()
  async get(@Param("project_id") project_id: string) {
    const orchestration = await getOrchestrationOrNull(this.orchestration, project_id);
    return {
      success: true,
      data: {
        orchestration,
        projectState: await getProjectState(this.workItems, project_id),
        pendingActionRequests: orchestration
          ? await this.orchestration.listProjectActionRequests(project_id, "pending")
          : [],
      },
    };
  }

  @Patch()
  async updateMode(
    @Param("project_id") project_id: string,
    @Body() body: UpdateOrchestrationModeBody,
  ) {
    const mode = body.orchestration_mode;
    if (!mode) {
      throw new BadRequestException("orchestration_mode is required");
    }

    const data = await this.policy.applyPreset(project_id, mode);
    return { success: true, data };
  }

  @Post("pause")
  async pause(@Param("project_id") project_id: string) {
    const data = await this.orchestration.pause(project_id);
    return { success: true, data };
  }

  @Post("resume")
  async resume(@Param("project_id") project_id: string) {
    const data = await this.orchestration.resume(project_id);
    return { success: true, data };
  }

  @Post("complete")
  async complete(@Param("project_id") project_id: string) {
    const data = await this.orchestration.complete(project_id);
    return { success: true, data };
  }

  @Post("cycle")
  async triggerCycle(
    @Param("project_id") project_id: string,
    @Body() body: TriggerCycleBody,
  ) {
    const reason = body.reason ?? "manual_trigger";
    const data = await this.wakeup.requestWakeup({
      projectId: project_id,
      reason,
      source: "manual_trigger",
    });
    return { success: true, data };
  }

  @Get("timeline")
  async getTimeline(@Param("project_id") project_id: string) {
    const orchestration = await getOrchestrationOrNull(this.orchestration, project_id);
    const decisionLog = orchestration?.decisionLog ?? [];
    return { success: true, data: decisionLog };
  }

  @Post("recovery/imported-hydration")
  async recoverImportedHydration(@Param("project_id") project_id: string) {
    const data = await this.orchestration.recoverImportedHydration(project_id);
    return { success: true, data };
  }

  @Get("diagnostics")
  async diagnostics(@Param("project_id") project_id: string) {
    return {
      success: true,
      data: await this.orchestration.getDiagnostics(project_id),
    };
  }

  @Get("pending-actions")
  async pendingActions(@Param("project_id") project_id: string) {
    const data = await this.orchestration.listProjectActionRequests(project_id, "pending");
    return { success: true, data };
  }

  @Post("decision-log")
  async recordDecision(
    @Param("project_id") project_id: string,
    @Body() body: RecordDecisionBody,
  ) {
    const data = await this.orchestration.recordDecision(project_id, {
      type: requireString(body.type, "type"),
      reasoning: requireString(body.reasoning, "reasoning"),
      actions: Array.isArray(body.actions) ? body.actions : [],
      requestedAction: body.requested_action,
      modeEvaluation: body.mode_evaluation,
      executionStatus: body.execution_status,
      recommendation: body.recommendation,
    });
    return { success: true, data };
  }

  @Post("action-requests")
  async requestAction(
    @Param("project_id") project_id: string,
    @Body() body: RequestActionBody,
  ) {
    const data = await this.orchestration.requestAction(project_id, {
      action: requireString(body.action, "action"),
      payload: body.payload,
      requestedBy: body.requested_by,
      workflowRunId: body.workflow_run_id,
    });
    return { success: true, data };
  }

  @Post("action-requests/:requestId/approve")
  async approveActionRequest(
    @Param("project_id") project_id: string,
    @Param("requestId") requestId: string,
    @Body() body: ApproveActionBody,
  ) {
    const data = await this.orchestration.approveActionRequest(
      project_id,
      requestId,
      { approvedBy: body.approved_by },
    );
    return { success: true, data };
  }

  @Post("action-requests/:requestId/reject")
  async rejectActionRequest(
    @Param("project_id") project_id: string,
    @Param("requestId") requestId: string,
    @Body() body: RejectActionBody,
  ) {
    const data = await this.orchestration.rejectActionRequest(
      project_id,
      requestId,
      { rejectedBy: body.rejected_by, reason: body.reason },
    );
    return { success: true, data };
  }
}