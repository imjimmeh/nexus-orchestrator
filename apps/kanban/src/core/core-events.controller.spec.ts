import { CoreWorkflowRunEventEnvelopeV1Schema } from "@nexus/core";
import { describe, expect, it } from "vitest";
import { INTERNAL_SERVICE_SCOPES_METADATA_KEY } from "../common/internal-service-scopes.decorator";
import { CoreEventsController } from "./core-events.controller";

describe("CoreEventsController", () => {
  it("ingests core workflow lifecycle events and returns projection", async () => {
    const projectionService = {
      recordCoreLifecycleEvent: (event: {
        payload: {
          run_id: string;
          status: string;
          context?: {
            contextId: string;
            metadata?: Record<string, unknown> | null;
          } | null;
        };
      }) =>
        Promise.resolve({
          runId: event.payload.run_id,
          workflowId: "wf-1",
          status: event.payload.status,
          project_id: event.payload.context?.contextId ?? null,
          workItemId:
            typeof event.payload.context?.metadata?.workItemId === "string"
              ? event.payload.context.metadata.workItemId
              : null,
          occurredAt: "2026-04-13T00:00:01.000Z",
          lastEventId: "evt-core-1",
          lastEventType: "core.workflow.run.status_changed.v1" as const,
        }),
    };
    const lifecycleConsumer = {
      replayFromCursor: () => Promise.resolve({ processed: 0 }),
      getDiagnostics: () => Promise.resolve({ healthy: true }),
    };
    const controller = new CoreEventsController(
      projectionService as never,
      lifecycleConsumer as never,
    );

    const event = CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: "evt-core-1",
      event_type: "core.workflow.run.status_changed.v1",
      event_version: "v1",
      occurred_at: "2026-04-13T00:00:01.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "RUNNING",
        context: {
          scopeId: "project-1",
          contextId: "project-1",
          contextType: "kanban.project",
          metadata: { workItemId: "work-item-1" },
        },
      },
    });

    const response = await controller.ingestCoreEvent(event);

    expect(response.success).toBe(true);
    expect(response.data).toEqual(
      expect.objectContaining({
        runId: "run-1",
        status: "RUNNING",
        project_id: "project-1",
        workItemId: "work-item-1",
      }),
    );
  });

  it("delegates dead-letter replay to the lifecycle consumer with the parsed body", async () => {
    const projectionService = { recordCoreLifecycleEvent: () => undefined };
    const lifecycleConsumer = {
      replayFromCursor: () => Promise.resolve({ processed: 0 }),
      getDiagnostics: () => Promise.resolve({ healthy: true }),
      replayDeadLetters: (opts?: { proposalIds?: string[] }) => {
        expect(opts).toEqual({ proposalIds: ["prop-1"] });
        return Promise.resolve({ replayed: 2, skipped: 1 });
      },
    };
    const controller = new CoreEventsController(
      projectionService as never,
      lifecycleConsumer as never,
    );

    const response = await controller.replayDeadLetterStream({
      proposalIds: ["prop-1"],
    });

    expect(response).toEqual({
      success: true,
      data: { replayed: 2, skipped: 1 },
    });
  });

  it("defaults to an empty replay filter when no body is sent", async () => {
    const projectionService = { recordCoreLifecycleEvent: () => undefined };
    const lifecycleConsumer = {
      replayFromCursor: () => Promise.resolve({ processed: 0 }),
      getDiagnostics: () => Promise.resolve({ healthy: true }),
      replayDeadLetters: (opts?: { proposalIds?: string[] }) => {
        expect(opts).toEqual({});
        return Promise.resolve({ replayed: 0, skipped: 0 });
      },
    };
    const controller = new CoreEventsController(
      projectionService as never,
      lifecycleConsumer as never,
    );

    const response = await controller.replayDeadLetterStream(undefined);

    expect(response).toEqual({
      success: true,
      data: { replayed: 0, skipped: 0 },
    });
  });

  it("rejects a malformed dead-letter replay body", async () => {
    const projectionService = { recordCoreLifecycleEvent: () => undefined };
    const lifecycleConsumer = {
      replayFromCursor: () => Promise.resolve({ processed: 0 }),
      getDiagnostics: () => Promise.resolve({ healthy: true }),
      replayDeadLetters: () => Promise.resolve({ replayed: 0, skipped: 0 }),
    };
    const controller = new CoreEventsController(
      projectionService as never,
      lifecycleConsumer as never,
    );

    await expect(
      controller.replayDeadLetterStream({ proposalIds: [""] }),
    ).rejects.toThrow();
  });

  it("guards the dead-letter replay route with the core-events write scope", () => {
    const handler = Reflect.get(
      CoreEventsController.prototype,
      "replayDeadLetterStream",
    );

    const scopes = Reflect.getMetadata(
      INTERNAL_SERVICE_SCOPES_METADATA_KEY,
      handler,
    );

    expect(scopes).toEqual(["kanban.core-events:write"]);
  });
});
