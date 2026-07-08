import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestrationActionRequestsService } from "./orchestration-action-requests.service";
import type { WorkItemService } from "../work-item/work-item.service";
import type { OrchestrationPersistenceRecord } from "./orchestration-internal.types";

function buildPersistenceState(
  overrides: Partial<OrchestrationPersistenceRecord> = {},
): OrchestrationPersistenceRecord {
  return {
    project_id: "project-1",
    mode: "supervised",
    status: "orchestrating",
    linked_run_id: null,
    goals: [],
    action_requests: [],
    decision_log: [],
    metadata: {},
    ...overrides,
  } as OrchestrationPersistenceRecord;
}

describe("OrchestrationActionRequestsService — approval execution", () => {
  let service: OrchestrationActionRequestsService;
  let updateStatus: ReturnType<typeof vi.fn>;
  let mockWorkItemService: WorkItemService;
  let persistenceState: OrchestrationPersistenceRecord;
  let requirePersistenceState: ReturnType<typeof vi.fn>;
  let savePersistenceState: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    updateStatus = vi.fn(() =>
      Promise.resolve({ id: "wi-1", status: "todo" } as never),
    );
    mockWorkItemService = { updateStatus } as never;

    persistenceState = buildPersistenceState({
      action_requests: [
        {
          id: "req-1",
          project_id: "project-1",
          action: "approve_refinement_plan_exit",
          payload: {
            workItemId: "wi-1",
            toStatus: "todo",
            riskLevel: "high",
          },
          workflowRunId: null,
          modeAtRequest: "supervised",
          requestedBy: "work_item_refinement_default",
          status: "pending",
          approvedBy: null,
          approvedAt: null,
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: null,
          executedAt: null,
          errorMessage: null,
          correlationId: "corr-1",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });

    requirePersistenceState = vi.fn(() => Promise.resolve(persistenceState));
    savePersistenceState = vi.fn(() => Promise.resolve(persistenceState));

    service = new OrchestrationActionRequestsService(
      { getRequestId: () => null },
      { findAll: () => Promise.resolve([]) } as never,
      mockWorkItemService,
    );
  });

  it("executes the transition when action is approve_refinement_plan_exit and status becomes approved", async () => {
    const result = await service.approveActionRequest({
      projectId: "project-1",
      requestId: "req-1",
      input: { approvedBy: "human" },
      requirePersistenceState,
      savePersistenceState,
    });

    expect(result.status).toBe("approved");
    expect(updateStatus).toHaveBeenCalledWith("project-1", "wi-1", "todo");
  });

  it("does not execute when action does not match approve_refinement_plan_exit", async () => {
    persistenceState = buildPersistenceState({
      action_requests: [
        {
          id: "req-2",
          project_id: "project-1",
          action: "some_other_action",
          payload: { workItemId: "wi-2", toStatus: "done" },
          workflowRunId: null,
          modeAtRequest: "supervised",
          requestedBy: "test",
          status: "pending",
          approvedBy: null,
          approvedAt: null,
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: null,
          executedAt: null,
          errorMessage: null,
          correlationId: "corr-2",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });

    requirePersistenceState.mockResolvedValue(persistenceState);

    const result = await service.approveActionRequest({
      projectId: "project-1",
      requestId: "req-2",
      input: { approvedBy: "human" },
      requirePersistenceState,
      savePersistenceState,
    });

    expect(result.status).toBe("approved");
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("does not execute when payload is missing workItemId", async () => {
    persistenceState = buildPersistenceState({
      action_requests: [
        {
          id: "req-3",
          project_id: "project-1",
          action: "approve_refinement_plan_exit",
          payload: { toStatus: "done" },
          workflowRunId: null,
          modeAtRequest: "supervised",
          requestedBy: "test",
          status: "pending",
          approvedBy: null,
          approvedAt: null,
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: null,
          executedAt: null,
          errorMessage: null,
          correlationId: "corr-3",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });

    requirePersistenceState.mockResolvedValue(persistenceState);

    const result = await service.approveActionRequest({
      projectId: "project-1",
      requestId: "req-3",
      input: { approvedBy: "human" },
      requirePersistenceState,
      savePersistenceState,
    });

    expect(result.status).toBe("approved");
    expect(updateStatus).not.toHaveBeenCalled();
  });
});
