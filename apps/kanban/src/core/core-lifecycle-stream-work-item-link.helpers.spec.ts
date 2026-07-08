import {
  CoreWorkflowRunEventEnvelopeV1Schema,
  CoreWorkflowStepEventEnvelopeV1Schema,
  type CoreWorkflowEventEnvelopeV1Shape,
} from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  linkWorkItemRunFromLifecycleEvent,
  type LinkWorkItemRunFromLifecycleEventDeps,
} from "./core-lifecycle-stream-work-item-link.helpers";

function makeRunningEnvelope(
  correlationId = "corr-1",
): CoreWorkflowEventEnvelopeV1Shape {
  return CoreWorkflowRunEventEnvelopeV1Schema.parse({
    event_id: "evt-1",
    event_type: "core.workflow.run.status_changed.v1",
    event_version: "v1",
    occurred_at: "2026-06-23T00:00:00.000Z",
    correlation_id: correlationId,
    source_service: "core",
    payload: {
      run_id: "run-1",
      workflow_id: "wf-1",
      status: "RUNNING",
      context: {
        scopeId: "project-1",
        contextId: "work-item-1",
        contextType: "kanban.project",
        metadata: { work_item_id: "work-item-1" },
      },
    },
  });
}

interface MockFakes {
  deps: LinkWorkItemRunFromLifecycleEventDeps;
  workItems: { linkRunIfUnlinked: ReturnType<typeof vi.fn> };
  leaseService: {
    acquireRunLease: ReturnType<typeof vi.fn>;
    releaseRunLease: ReturnType<typeof vi.fn>;
    deriveOwnerId: ReturnType<typeof vi.fn>;
  };
  log: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
}

function makeFakes(): MockFakes {
  const workItems = {
    linkRunIfUnlinked: vi.fn().mockResolvedValue(true),
  };
  const leaseService = {
    acquireRunLease: vi.fn().mockResolvedValue({
      acquired: true,
      leaseIds: ["lease-1"],
    }),
    releaseRunLease: vi.fn().mockResolvedValue(undefined),
    deriveOwnerId: vi.fn(
      (projectId: string, workItemId: string, action: string) =>
        `kanban:work-item-run:${projectId}:${workItemId}:${action}`,
    ),
  };
  const log = vi.fn();
  const warn = vi.fn();
  const logger = { log, warn };
  return {
    deps: {
      logger: logger as never,
      workItems: workItems as never,
      workItemRunLeaseService: leaseService as never,
    },
    workItems,
    leaseService,
    log,
    warn,
  };
}

describe("linkWorkItemRunFromLifecycleEvent", () => {
  let fakes: MockFakes;

  beforeEach(() => {
    fakes = makeFakes();
  });

  it("acquires the lease (action: lifecycle_link), links, and releases the lease on success", async () => {
    fakes.workItems.linkRunIfUnlinked.mockResolvedValueOnce(true);

    await linkWorkItemRunFromLifecycleEvent(fakes.deps, makeRunningEnvelope());

    expect(fakes.leaseService.acquireRunLease).toHaveBeenCalledTimes(1);
    const acquireArgs = fakes.leaseService.acquireRunLease.mock.calls[0][0];
    expect(acquireArgs.projectId).toBe("project-1");
    expect(acquireArgs.workItemId).toBe("work-item-1");
    expect(acquireArgs.action).toBe("lifecycle_link");
    expect(acquireArgs.ownerId).toContain(
      "kanban:work-item-run:project-1:work-item-1:lifecycle_link",
    );
    expect(fakes.workItems.linkRunIfUnlinked).toHaveBeenCalledWith({
      project_id: "project-1",
      workItemId: "work-item-1",
      runId: "run-1",
    });
    expect(fakes.leaseService.releaseRunLease).toHaveBeenCalledWith(
      "project-1",
      "kanban:work-item-run:project-1:work-item-1:lifecycle_link",
    );
  });

  it("skips linkRunIfUnlinked and does not release when the lease is held", async () => {
    fakes.leaseService.acquireRunLease.mockResolvedValueOnce({
      acquired: false,
      conflicts: [
        {
          conflictKey: {
            kind: "work_item",
            value: "work_item_dispatch:project-1:work-item-1",
          },
          heldByOwnerKind: "direct_mutation",
          heldByOwnerId:
            "kanban:work-item-run:project-1:work-item-1:dispatch",
          expiresAt: new Date(Date.now() + 30_000).toISOString(),
        },
      ],
    });

    await linkWorkItemRunFromLifecycleEvent(fakes.deps, makeRunningEnvelope());

    expect(fakes.workItems.linkRunIfUnlinked).not.toHaveBeenCalled();
    expect(fakes.leaseService.releaseRunLease).not.toHaveBeenCalled();
    expect(fakes.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping lifecycle-projection link"),
    );
    expect(fakes.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "kanban:work-item-run:project-1:work-item-1:dispatch",
      ),
    );
  });

  it("releases the lease even when linkRunIfUnlinked throws", async () => {
    fakes.workItems.linkRunIfUnlinked.mockRejectedValueOnce(
      new Error("transient link failure"),
    );

    await expect(
      linkWorkItemRunFromLifecycleEvent(fakes.deps, makeRunningEnvelope()),
    ).rejects.toThrow("transient link failure");

    expect(fakes.leaseService.acquireRunLease).toHaveBeenCalledTimes(1);
    expect(fakes.leaseService.releaseRunLease).toHaveBeenCalledWith(
      "project-1",
      "kanban:work-item-run:project-1:work-item-1:lifecycle_link",
    );
  });

  it("logs a warning when releaseRunLease throws (does not rethrow)", async () => {
    fakes.leaseService.releaseRunLease.mockRejectedValueOnce(
      new Error("release failed"),
    );

    await linkWorkItemRunFromLifecycleEvent(fakes.deps, makeRunningEnvelope());

    expect(fakes.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to release lifecycle_link lease"),
    );
  });

  it("returns early without acquiring a lease when the envelope status is terminal", async () => {
    const envelope = CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: "evt-1",
      event_type: "core.workflow.run.completed.v1",
      event_version: "v1",
      occurred_at: "2026-06-23T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "COMPLETED",
        context: {
          scopeId: "project-1",
          contextId: "work-item-1",
          contextType: "kanban.project",
          metadata: { work_item_id: "work-item-1" },
        },
      },
    });

    await linkWorkItemRunFromLifecycleEvent(fakes.deps, envelope);

    expect(fakes.leaseService.acquireRunLease).not.toHaveBeenCalled();
    expect(fakes.workItems.linkRunIfUnlinked).not.toHaveBeenCalled();
  });

  it("returns early without acquiring a lease when the work item is the orchestration-lifecycle marker", async () => {
    const envelope = CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: "evt-1",
      event_type: "core.workflow.run.status_changed.v1",
      event_version: "v1",
      occurred_at: "2026-06-23T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "RUNNING",
        context: {
          scopeId: "project-1",
          contextId: "__orchestration_lifecycle__",
          contextType: "kanban.project",
          metadata: { work_item_id: "__orchestration_lifecycle__" },
        },
      },
    });

    await linkWorkItemRunFromLifecycleEvent(fakes.deps, envelope);

    expect(fakes.leaseService.acquireRunLease).not.toHaveBeenCalled();
    expect(fakes.workItems.linkRunIfUnlinked).not.toHaveBeenCalled();
  });

  it("returns early without acquiring a lease when the project context is missing", async () => {
    const envelope = CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: "evt-1",
      event_type: "core.workflow.run.status_changed.v1",
      event_version: "v1",
      occurred_at: "2026-06-23T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "RUNNING",
        context: {
          scopeId: null,
          contextId: null,
          contextType: null,
          metadata: { work_item_id: "work-item-1" },
        },
      },
    });

    await linkWorkItemRunFromLifecycleEvent(fakes.deps, envelope);

    expect(fakes.leaseService.acquireRunLease).not.toHaveBeenCalled();
    expect(fakes.workItems.linkRunIfUnlinked).not.toHaveBeenCalled();
  });

  it("returns early without acquiring a lease when the event_type is not a core workflow run event", async () => {
    const envelope = CoreWorkflowStepEventEnvelopeV1Schema.parse({
      event_id: "evt-1",
      event_type: "core.workflow.step.completed.v1",
      event_version: "v1",
      occurred_at: "2026-06-23T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        job_id: "job-1",
        step_id: "step-1",
        status: "COMPLETED",
        context: {
          scopeId: "project-1",
          contextId: "work-item-1",
          contextType: "kanban.project",
          metadata: { work_item_id: "work-item-1" },
        },
      },
    });

    await linkWorkItemRunFromLifecycleEvent(fakes.deps, envelope);

    expect(fakes.leaseService.acquireRunLease).not.toHaveBeenCalled();
    expect(fakes.workItems.linkRunIfUnlinked).not.toHaveBeenCalled();
  });

  it("uses the envelope correlation id in the owner id when present", async () => {
    await linkWorkItemRunFromLifecycleEvent(
      fakes.deps,
      makeRunningEnvelope("corr-trace-7"),
    );

    const acquireArgs = fakes.leaseService.acquireRunLease.mock.calls[0][0];
    expect(acquireArgs.ownerId).toContain("corr-trace-7");
  });
});