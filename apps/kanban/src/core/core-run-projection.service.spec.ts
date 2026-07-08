import { CoreWorkflowRunEventEnvelopeV1Schema } from "@nexus/core";
import { beforeEach, describe, expect, it } from "vitest";
import { CoreRunProjectionService } from "./core-run-projection.service";
import type { CoreWorkflowRunLifecycleEventType } from "./core-run-projection.types";

describe("CoreRunProjectionService", () => {
  type StoredProjection = {
    run_id: string;
    workflow_id: string;
    status: string;
    project_id: string | null;
    work_item_id: string | null;
    occurred_at: Date;
    last_event_id: string;
    last_event_type: CoreWorkflowRunLifecycleEventType;
  };

  const projections = new Map<string, StoredProjection>();

  const repository = {
    save: (projection: StoredProjection) => {
      projections.set(projection.run_id, projection);
      return Promise.resolve(projection);
    },
    findByRunId: (runId: string) =>
      Promise.resolve(projections.get(runId) ?? null),
    findByproject_id: (project_id: string) =>
      Promise.resolve(
        [...projections.values()].filter(
          (projection) => projection.project_id === project_id,
        ),
      ),
  };

  beforeEach(() => {
    projections.clear();
  });

  const createEvent = (params: {
    event_id: string;
    event_type: CoreWorkflowRunLifecycleEventType;
    status: string;
    occurred_at: string;
    contextId?: string | null;
    metadata?: Record<string, unknown>;
  }) =>
    CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: params.event_id,
      event_type: params.event_type,
      event_version: "v1",
      occurred_at: params.occurred_at,
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "workflow-1",
        status: params.status,
        context: {
          scopeId: "project-1",
          contextId:
            params.contextId === undefined ? "project-1" : params.contextId,
          contextType: "kanban.project",
          metadata: params.metadata ?? { workItemId: "work-item-1" },
        },
      },
    });

  it("records a new core run lifecycle event", async () => {
    const service = new CoreRunProjectionService(repository as never);
    const projection = await service.recordCoreLifecycleEvent(
      createEvent({
        event_id: "evt-1",
        event_type: "core.workflow.run.accepted.v1",
        status: "RUNNING",
        occurred_at: "2026-04-13T00:00:01.000Z",
      }),
    );

    expect(projection).toEqual(
      expect.objectContaining({
        runId: "run-1",
        workflowId: "workflow-1",
        status: "RUNNING",
        project_id: "project-1",
        workItemId: "work-item-1",
        lastEventId: "evt-1",
      }),
    );
  });

  it("records work-item id from dispatch-generated context metadata", async () => {
    const service = new CoreRunProjectionService(repository as never);
    const projection = await service.recordCoreLifecycleEvent(
      createEvent({
        event_id: "evt-snake-metadata",
        event_type: "core.workflow.run.accepted.v1",
        status: "RUNNING",
        occurred_at: "2026-04-13T00:00:01.000Z",
        metadata: { work_item_id: "work-item-1" },
      }),
    );

    expect(projection.workItemId).toBe("work-item-1");
  });

  it("falls back to scope id when lifecycle context omits context id", async () => {
    const service = new CoreRunProjectionService(repository as never);

    await service.recordCoreLifecycleEvent(
      createEvent({
        event_id: "evt-scope-project",
        event_type: "core.workflow.run.accepted.v1",
        status: "RUNNING",
        occurred_at: "2026-04-13T00:00:01.000Z",
        contextId: null,
      }),
    );

    expect(projections.get("run-1")).toEqual(
      expect.objectContaining({
        project_id: "project-1",
      }),
    );
  });

  it("ignores duplicate event ids during replay", async () => {
    const service = new CoreRunProjectionService(repository as never);
    const accepted = createEvent({
      event_id: "evt-dup",
      event_type: "core.workflow.run.accepted.v1",
      status: "RUNNING",
      occurred_at: "2026-04-13T00:00:01.000Z",
    });
    const duplicate = createEvent({
      event_id: "evt-dup",
      event_type: "core.workflow.run.status_changed.v1",
      status: "FAILED",
      occurred_at: "2026-04-13T00:00:02.000Z",
    });

    await service.recordCoreLifecycleEvent(accepted);
    const replay = await service.recordCoreLifecycleEvent(duplicate);

    expect(replay.status).toBe("RUNNING");
    expect(replay.lastEventType).toBe("core.workflow.run.accepted.v1");
  });

  it("ignores stale events older than current projection", async () => {
    const service = new CoreRunProjectionService(repository as never);
    await service.recordCoreLifecycleEvent(
      createEvent({
        event_id: "evt-newer",
        event_type: "core.workflow.run.status_changed.v1",
        status: "RUNNING",
        occurred_at: "2026-04-13T00:00:03.000Z",
      }),
    );

    const stale = await service.recordCoreLifecycleEvent(
      createEvent({
        event_id: "evt-stale",
        event_type: "core.workflow.run.status_changed.v1",
        status: "FAILED",
        occurred_at: "2026-04-13T00:00:02.000Z",
      }),
    );

    expect(stale.status).toBe("RUNNING");
    expect(stale.lastEventId).toBe("evt-newer");
  });
});
