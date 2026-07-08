import { FailureClass } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { OrchestrationControlPlaneSchedulerService } from "./orchestration-control-plane-scheduler.service";
import { OrchestrationRepairLaneService } from "./orchestration-repair-lane.service";

function createService() {
  const scheduler = {
    createIntent: vi.fn(),
    publishFact: vi.fn(),
  };

  return {
    scheduler,
    service: new OrchestrationRepairLaneService(
      scheduler as unknown as OrchestrationControlPlaneSchedulerService,
    ),
  };
}

describe("OrchestrationRepairLaneService", () => {
  it("publishes an event delivery failure fact and repair intent", async () => {
    const { scheduler, service } = createService();

    await service.recordEventDeliveryFailure({
      projectId: "project-1",
      eventId: "event-1",
      eventName: "kanban.work_item.status_changed.v1",
      error: "Core unavailable",
      failureClass: FailureClass.EventDeliveryFailure,
    });

    expect(scheduler.publishFact).toHaveBeenCalledWith({
      projectId: "project-1",
      factType: "event_delivery_failed",
      subjectKind: "domain_event",
      subjectId: "event-1",
      sourceType: "kanban_event_delivery_projection",
      sourceId: "event-1",
      confidence: 1,
      payload: {
        eventName: "kanban.work_item.status_changed.v1",
        error: "Core unavailable",
        failureClass: FailureClass.EventDeliveryFailure,
      },
      expiresAt: expect.any(Date),
    });
    expect(scheduler.createIntent).toHaveBeenCalledWith({
      projectId: "project-1",
      lane: "repair",
      type: "repair_failed_run",
      requester: "event_delivery_projection",
      reason: "Repair failed event delivery event-1",
      conflictKeys: [{ kind: "workflow_scope", value: "event-replay:event-1" }],
      resources: [{ kind: "external_event", id: "event-1" }],
      workflow: { workflowId: "repair_failed_run", scope: "event-1" },
      idempotencyKey: "repair:event-delivery:event-1",
    });
  });

  it("records failed work item workflow runs as repair facts and intents", async () => {
    const { scheduler, service } = createService();

    await service.recordFailedWorkItemRun({
      projectId: "project-1",
      workflowRunId: "run-1",
      workItemId: "work-item-1",
      status: "FAILED",
      failureClass: FailureClass.SystemFailure,
    });

    expect(scheduler.publishFact).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        factType: "work_item_workflow_run_failed",
        subjectKind: "work_item",
        subjectId: "work-item-1",
        sourceId: "run-1",
      }),
    );
    expect(scheduler.createIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        lane: "repair",
        type: "repair_failed_run",
        idempotencyKey: "repair:failed-work-item-run:run-1",
        conflictKeys: expect.arrayContaining([
          { kind: "workflow_run", value: "run-1" },
          { kind: "work_item", value: "work-item-1" },
        ]),
      }),
    );
  });
});
