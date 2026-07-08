import {
  CoreWorkflowRunEventEnvelopeV1Schema,
  CoreWorkflowStepEventEnvelopeV1Schema,
  EventEnvelopeV1Schema,
  InterServiceEventEnvelopeV1Schema,
} from "./event-envelope.schema";

describe("EventEnvelopeV1 schemas", () => {
  it("accepts a valid core workflow run event envelope", () => {
    const parsed = CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: "evt-core-1",
      event_type: "core.workflow.run.status_changed.v1",
      event_version: "v1",
      occurred_at: "2026-04-13T00:00:00.000Z",
      correlation_id: "corr-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "workflow-1",
        status: "RUNNING",
        context: {
          scopeId: "scope-1",
          contextId: "context-1",
          contextType: "workflow",
          metadata: { traceId: "trace-1" },
        },
      },
    });

    expect(parsed.payload.status).toBe("RUNNING");
    expect(parsed.payload.context?.contextId).toBe("context-1");
  });

  it("accepts run usage totals on a terminal run event payload", () => {
    const parsed = CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: "evt-core-usage",
      event_type: "core.workflow.run.completed.v1",
      event_version: "v1",
      occurred_at: "2026-04-13T00:00:00.000Z",
      correlation_id: "corr-usage",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "workflow-1",
        status: "COMPLETED",
        usage: {
          total_tokens: 1234,
          input_tokens: 1000,
          output_tokens: 234,
          priced_turn_count: 403,
        },
      },
    });

    expect(parsed.payload.usage?.total_tokens).toBe(1234);
    expect(parsed.payload.usage?.priced_turn_count).toBe(403);
  });

  it("accepts a per-model usage breakdown on a terminal run event payload", () => {
    const parsed = CoreWorkflowRunEventEnvelopeV1Schema.parse({
      event_id: "evt-core-usage-breakdown",
      event_type: "core.workflow.run.completed.v1",
      event_version: "v1",
      occurred_at: "2026-04-13T00:00:00.000Z",
      correlation_id: "corr-usage-breakdown",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "workflow-1",
        status: "COMPLETED",
        usage: {
          total_tokens: 1234,
          input_tokens: 1000,
          output_tokens: 234,
          model_breakdown: [
            {
              model_id: "model-1",
              provider_name: "anthropic",
              model_name: "claude-sonnet-5",
              input_tokens: 1000,
              output_tokens: 234,
              cost_cents: 12,
            },
          ],
        },
      },
    });

    expect(parsed.payload.usage?.model_breakdown?.[0]?.model_name).toBe(
      "claude-sonnet-5",
    );
  });

  it("rejects unexpected identity fields on core workflow event payloads", () => {
    expect(() =>
      CoreWorkflowRunEventEnvelopeV1Schema.parse({
        event_id: "evt-core-identity",
        event_type: "core.workflow.run.status_changed.v1",
        event_version: "v1",
        occurred_at: "2026-04-13T00:00:00.000Z",
        correlation_id: "corr-identity",
        source_service: "core",
        payload: {
          run_id: "run-1",
          workflow_id: "workflow-1",
          status: "RUNNING",
          resource_scope_id: "scope-1",
          resource_context_id: "context-1",
        },
      }),
    ).toThrow();
  });

  it("accepts a valid core workflow step event envelope", () => {
    const parsed = CoreWorkflowStepEventEnvelopeV1Schema.parse({
      event_id: "evt-step-1",
      event_type: "core.workflow.step.completed.v1",
      event_version: "v1",
      occurred_at: "2026-04-13T00:00:00.000Z",
      correlation_id: "corr-step-1",
      source_service: "core",
      payload: {
        run_id: "run-1",
        workflow_id: "workflow-1",
        job_id: "job-1",
        step_id: "step-1",
        status: "COMPLETED",
        started_at: "2026-04-13T00:00:00.000Z",
        completed_at: "2026-04-13T00:00:01.000Z",
        context: {
          scopeId: "scope-1",
          contextId: "context-1",
          contextType: "workflow",
          metadata: { traceId: "trace-1" },
        },
      },
    });

    expect(parsed.payload.job_id).toBe("job-1");
    expect(parsed.payload.step_id).toBe("step-1");
    expect(parsed.payload.context?.metadata?.traceId).toBe("trace-1");
  });

  it("rejects unexpected identity fields on core workflow step event payloads", () => {
    expect(() =>
      CoreWorkflowStepEventEnvelopeV1Schema.parse({
        event_id: "evt-step-identity",
        event_type: "core.workflow.step.failed.v1",
        event_version: "v1",
        occurred_at: "2026-04-13T00:00:00.000Z",
        correlation_id: "corr-step-identity",
        source_service: "core",
        payload: {
          run_id: "run-1",
          workflow_id: "workflow-1",
          job_id: "job-1",
          status: "FAILED",
          resource_scope_id: "scope-1",
          resource_context_id: "context-1",
        },
      }),
    ).toThrow();
  });

  it("rejects invalid versions", () => {
    expect(() =>
      CoreWorkflowRunEventEnvelopeV1Schema.parse({
        event_id: "evt-core-2",
        event_type: "core.workflow.run.completed.v1",
        event_version: "v2",
        occurred_at: "2026-04-13T00:00:00.000Z",
        correlation_id: "corr-2",
        source_service: "core",
        payload: {
          run_id: "run-2",
          workflow_id: "workflow-2",
          status: "COMPLETED",
        },
      }),
    ).toThrow();
  });

  it("rejects unsupported domain events through core event unions", () => {
    expect(() =>
      InterServiceEventEnvelopeV1Schema.parse({
        event_id: "evt-domain-1",
        event_type: "inventory.item.status_changed.v1",
        event_version: "v1",
        occurred_at: "2026-04-13T00:00:00.000Z",
        correlation_id: "corr-3",
        source_service: "inventory",
        payload: {
          resource_scope_id: "scope-1",
          resource_context_id: "context-1",
          status: "in-progress",
        },
      }),
    ).toThrow();
  });

  it("accepts neutral service slugs in the generic envelope schema", () => {
    const parsed = EventEnvelopeV1Schema.parse({
      event_id: "evt-inventory-1",
      event_type: "core.workflow.run.status_changed.v1",
      event_version: "v1",
      occurred_at: "2026-04-13T00:00:00.000Z",
      correlation_id: "corr-inventory-1",
      source_service: "inventory_api",
      payload: {
        run_id: "run-1",
      },
    });

    expect(parsed.source_service).toBe("inventory_api");
  });

  it("rejects invalid service slugs in the generic envelope schema", () => {
    expect(() =>
      EventEnvelopeV1Schema.parse({
        event_id: "evt-invalid-source-1",
        event_type: "core.workflow.run.status_changed.v1",
        event_version: "v1",
        occurred_at: "2026-04-13T00:00:00.000Z",
        correlation_id: "corr-invalid-source-1",
        source_service: "Inventory API",
        payload: {
          run_id: "run-1",
        },
      }),
    ).toThrow();
  });

  it("accepts chat memory lifecycle events through union schema", () => {
    const parsed = InterServiceEventEnvelopeV1Schema.parse({
      event_id: "evt-chat-1",
      event_type: "chat.memory.promoted.v1",
      event_version: "v1",
      occurred_at: "2026-04-13T00:00:00.000Z",
      correlation_id: "corr-4",
      source_service: "chat",
      payload: {
        chat_session_id: "session-1",
        memory_id: "memory-1",
        action: "promoted",
      },
    });

    expect(parsed.event_type).toBe("chat.memory.promoted.v1");
  });

  it("preserves required envelope fields for additive-only compatibility", () => {
    const requiredKeys = [
      "event_id",
      "event_type",
      "event_version",
      "occurred_at",
      "correlation_id",
      "source_service",
      "payload",
    ];
    const schemaKeys = Object.keys(EventEnvelopeV1Schema.shape);

    expect(schemaKeys).toEqual(expect.arrayContaining(requiredKeys));
  });
});
