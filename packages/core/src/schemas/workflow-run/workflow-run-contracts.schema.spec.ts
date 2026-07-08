import {
  WORKFLOW_RUN_EXECUTION_STATUS_VALUES,
  WorkflowRunAcceptedV1Schema,
  WorkflowRunControlRequestV1Schema,
  WorkflowRunControlResultV1Schema,
  WorkflowRunExecutionStatusV1Schema,
  WorkflowRunRequestV1Schema,
  WorkflowRunStatusV1Schema,
} from "./workflow-run-contracts.schema";
import { WorkflowStatus } from "../../interfaces/workflow-legacy.types";

describe("workflow run contract schemas", () => {
  it("accepts a workflow run request", () => {
    const parsed = WorkflowRunRequestV1Schema.parse({
      workflow_id: "workflow-1",
      input: { objective: "Ship EPIC-089" },
      launch_source: "manual",
      context: {
        scopeId: "scope-1",
        contextId: "resource-1",
        contextType: "resource",
        metadata: { resourceId: "resource-1" },
      },
      metadata: {
        correlation_id: "corr-1",
        requested_by: "tester",
      },
    });

    expect(parsed.workflow_id).toBe("workflow-1");
    expect(parsed.context?.contextId).toBe("resource-1");
  });

  it("rejects first-class unsupported identity on workflow run requests", () => {
    expect(() =>
      WorkflowRunRequestV1Schema.parse({
        workflow_id: "workflow-1",
        input: {},
        launch_source: "manual",
        unsupported_scope_id: "scope-1",
        unsupported_context_id: "resource-1",
        metadata: {
          correlation_id: "corr-1",
        },
      }),
    ).toThrow();
  });

  it("rejects workflow run requests without metadata", () => {
    expect(() =>
      WorkflowRunRequestV1Schema.parse({
        workflow_id: "workflow-1",
        input: {},
        launch_source: "manual",
      }),
    ).toThrow();
  });

  it("accepts run accepted and status payloads", () => {
    const accepted = WorkflowRunAcceptedV1Schema.parse({
      run_id: "run-1",
      workflow_id: "workflow-1",
      status: "accepted",
      accepted_at: "2026-04-13T00:00:00.000Z",
      metadata: {
        correlation_id: "corr-1",
      },
    });
    const status = WorkflowRunStatusV1Schema.parse({
      run_id: "run-1",
      workflow_id: "workflow-1",
      status: "RUNNING",
      updated_at: "2026-04-13T00:01:00.000Z",
      metadata: {
        correlation_id: "corr-1",
      },
    });

    expect(accepted.status).toBe("accepted");
    expect(status.status).toBe("RUNNING");
  });

  it("accepts run control request/result payloads", () => {
    const request = WorkflowRunControlRequestV1Schema.parse({
      run_id: "run-2",
      action: "pause",
      metadata: {
        correlation_id: "corr-2",
      },
    });
    const result = WorkflowRunControlResultV1Schema.parse({
      run_id: "run-2",
      action: "pause",
      accepted: true,
      status: "RUNNING",
      updated_at: "2026-04-13T00:02:00.000Z",
      metadata: {
        correlation_id: "corr-2",
      },
    });

    expect(request.action).toBe("pause");
    expect(result.accepted).toBe(true);
  });

  it("keeps required run status enum values stable", () => {
    const requiredStatuses = [
      "PENDING",
      "RUNNING",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
    ];
    const enumOptions = [...WorkflowRunExecutionStatusV1Schema.options];

    expect(enumOptions).toEqual(expect.arrayContaining(requiredStatuses));
  });

  it("uses canonical run status values for the schema options", () => {
    expect(WorkflowRunExecutionStatusV1Schema.options).toEqual(
      WORKFLOW_RUN_EXECUTION_STATUS_VALUES,
    );
    expect(Object.values(WorkflowStatus)).toEqual(
      WORKFLOW_RUN_EXECUTION_STATUS_VALUES,
    );
  });
});
