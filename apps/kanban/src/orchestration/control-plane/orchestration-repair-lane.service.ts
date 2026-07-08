import { Injectable } from "@nestjs/common";
import type { FailureClass } from "@nexus/core";
import { OrchestrationControlPlaneSchedulerService } from "./orchestration-control-plane-scheduler.service";

@Injectable()
export class OrchestrationRepairLaneService {
  constructor(
    private readonly scheduler: OrchestrationControlPlaneSchedulerService,
  ) {}

  /**
   * Records a domain event delivery failure. The `failureClass` field
   * is threaded into the fact payload so the failure-threshold
   * retrospective trigger can apply the
   * `EventDeliveryFailure`-counts-toward-threshold semantic. Callers
   * MUST pass `FailureClass.EventDeliveryFailure` from the kanban
   * lifecycle event publisher.
   *
   * Work item: 2a64258d-8542-4ca0-b582-42a69dd61ff0 (WI-2026-062).
   */
  async recordEventDeliveryFailure(input: {
    readonly projectId: string;
    readonly eventId: string;
    readonly eventName: string;
    readonly error: string;
    readonly failureClass: FailureClass;
  }): Promise<void> {
    await this.scheduler.publishFact({
      projectId: input.projectId,
      factType: "event_delivery_failed",
      subjectKind: "domain_event",
      subjectId: input.eventId,
      sourceType: "kanban_event_delivery_projection",
      sourceId: input.eventId,
      confidence: 1,
      payload: {
        eventName: input.eventName,
        error: input.error,
        failureClass: input.failureClass,
      },
      expiresAt: new Date(Date.now() + 1000 * 60 * 30),
    });

    await this.scheduler.createIntent({
      projectId: input.projectId,
      lane: "repair",
      type: "repair_failed_run",
      requester: "event_delivery_projection",
      reason: `Repair failed event delivery ${input.eventId}`,
      conflictKeys: [
        { kind: "workflow_scope", value: `event-replay:${input.eventId}` },
      ],
      resources: [{ kind: "external_event", id: input.eventId }],
      workflow: { workflowId: "repair_failed_run", scope: input.eventId },
      idempotencyKey: `repair:event-delivery:${input.eventId}`,
    });
  }

  /**
   * Records a failed work item workflow run. The `failureClass` field
   * is threaded into the fact payload so the failure-threshold
   * retrospective trigger can apply the right semantic. Callers
   * SHOULD pass `FailureClass.QaRejection` when the work item's
   * metadata indicates a QA agent rejection (so the failure is
   * observed but NOT counted toward the threshold) and
   * `FailureClass.SystemFailure` for container-lost / orchestrator
   * errors.
   *
   * Work item: 2a64258d-8542-4ca0-b582-42a69dd61ff0 (WI-2026-062).
   */
  async recordFailedWorkItemRun(input: {
    readonly projectId: string;
    readonly workflowRunId: string;
    readonly workItemId: string;
    readonly status: "FAILED" | "CANCELLED";
    readonly failureClass: FailureClass;
  }): Promise<void> {
    await this.scheduler.publishFact({
      projectId: input.projectId,
      factType: "work_item_workflow_run_failed",
      subjectKind: "work_item",
      subjectId: input.workItemId,
      sourceType: "core_lifecycle_reconciler",
      sourceId: input.workflowRunId,
      confidence: 1,
      payload: {
        ...input,
      },
      expiresAt: new Date(Date.now() + 1000 * 60 * 30),
    });

    await this.scheduler.createIntent({
      projectId: input.projectId,
      lane: "repair",
      type: "repair_failed_run",
      requester: "core_lifecycle_reconciler",
      reason: `Repair failed work item run ${input.workflowRunId}`,
      conflictKeys: [
        { kind: "workflow_run", value: input.workflowRunId },
        { kind: "work_item", value: input.workItemId },
      ],
      resources: [
        { kind: "workflow_run", id: input.workflowRunId },
        { kind: "work_item", id: input.workItemId },
      ],
      workflow: {
        workflowId: "repair_failed_run",
        scope: input.workflowRunId,
      },
      idempotencyKey: `repair:failed-work-item-run:${input.workflowRunId}`,
    });
  }
}
