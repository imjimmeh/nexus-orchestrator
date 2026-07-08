import { FailureClass } from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  accrueWorkItemTokenSpend,
  reconcileTerminalWorkflowRun,
  recordWorkItemRunCostAttempt,
  recordTerminalRepairEvidence,
  resolveProjectIdForWorkflowRun,
  resolveWorkItemRunFailureClass,
} from "./core-lifecycle-stream-terminal-projection.helpers";
import type {
  TerminalProjectionDeps,
  TerminalWorkItemRunDeps,
} from "./core-lifecycle-stream-terminal-projection.types";

interface MockFakes {
  terminalProjectionDeps: TerminalProjectionDeps;
  terminalWorkItemRunDeps: TerminalWorkItemRunDeps;
  log: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  verbose: ReturnType<typeof vi.fn>;
  orchestrationService: {
    reconcileLinkedWorkflowRun: ReturnType<typeof vi.fn>;
    findByLinkedWorkflowRun: ReturnType<typeof vi.fn>;
  };
  workItems: {
    addTokenSpend: ReturnType<typeof vi.fn>;
    addCostSpend: ReturnType<typeof vi.fn>;
    findByProjectAndId: ReturnType<typeof vi.fn>;
  };
  workItemRunCosts: {
    recordAttempt: ReturnType<typeof vi.fn>;
  };
  repairLane: { recordFailedWorkItemRun: ReturnType<typeof vi.fn> };
}

type UsagePayload = {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_cents?: number;
  priced_turn_count?: number;
  model_breakdown?: Array<{
    model_id: string;
    provider_name: string;
    model_name: string;
    input_tokens: number;
    output_tokens: number;
    cost_cents: number;
  }>;
};

type RunEventPayload = {
  run_id: string;
  workflow_id: string;
  status: string;
  usage?: UsagePayload | null;
};

function makeFakes(): MockFakes {
  const log = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const debug = vi.fn();
  const verbose = vi.fn();
  // The NestJS `Logger` interface declares the methods as method signatures
  // (not arrow function properties), so the `@typescript-eslint/unbound-method`
  // rule complains when callers do `expect(logger.warn)...`. We satisfy the
  // interface with a structural cast here; the helper code only ever reads
  // the functions via the deps object, never separates them from `this`.
  const logger = { log, warn, error, debug, verbose };
  const orchestrationService = {
    reconcileLinkedWorkflowRun: vi.fn().mockResolvedValue({ cleared: true }),
    findByLinkedWorkflowRun: vi.fn().mockResolvedValue(null),
  };
  const workItems = {
    addTokenSpend: vi.fn().mockResolvedValue(true),
    addCostSpend: vi.fn().mockResolvedValue(true),
    findByProjectAndId: vi.fn().mockResolvedValue(null),
  };
  const workItemRunCosts = {
    recordAttempt: vi.fn().mockResolvedValue({ inserted: true }),
  };
  const repairLane = {
    recordFailedWorkItemRun: vi.fn().mockResolvedValue(undefined),
  };
  const terminalProjectionDeps: TerminalProjectionDeps = {
    logger: logger as never,
    orchestrationService: orchestrationService as never,
    workItems: workItems as never,
    workItemRunCosts: workItemRunCosts as never,
  };
  const terminalWorkItemRunDeps: TerminalWorkItemRunDeps = {
    ...terminalProjectionDeps,
    repairLane: repairLane as never,
  };
  return {
    terminalProjectionDeps,
    terminalWorkItemRunDeps,
    log,
    warn,
    error,
    debug,
    verbose,
    orchestrationService,
    workItems,
    workItemRunCosts,
    repairLane,
  };
}

describe("resolveProjectIdForWorkflowRun", () => {
  let f: MockFakes;

  beforeEach(() => {
    f = makeFakes();
  });

  it("returns the scopeId when present", async () => {
    const result = await resolveProjectIdForWorkflowRun(
      f.terminalProjectionDeps,
      "run-1",
      {
        scopeId: "project-from-scope",
        contextId: "project-from-context",
        contextType: "kanban.project",
        scopeNodeId: null,
        scopePath: null,
      },
    );
    expect(result).toBe("project-from-scope");
    expect(
      f.orchestrationService.findByLinkedWorkflowRun,
    ).not.toHaveBeenCalled();
  });

  it("falls back to contextId when scopeId is missing", async () => {
    const result = await resolveProjectIdForWorkflowRun(
      f.terminalProjectionDeps,
      "run-1",
      {
        scopeId: null,
        contextId: "project-from-context",
        contextType: "kanban.project",
        scopeNodeId: null,
        scopePath: null,
      },
    );
    expect(result).toBe("project-from-context");
    expect(
      f.orchestrationService.findByLinkedWorkflowRun,
    ).not.toHaveBeenCalled();
  });

  it("falls back to the orchestration linked-workflow-run lookup when no context id is present", async () => {
    f.orchestrationService.findByLinkedWorkflowRun.mockResolvedValueOnce({
      project_id: "project-from-orchestration",
      linked_run_id: "run-1",
    });
    const result = await resolveProjectIdForWorkflowRun(
      f.terminalProjectionDeps,
      "run-1",
      null,
    );
    expect(result).toBe("project-from-orchestration");
    expect(f.orchestrationService.findByLinkedWorkflowRun).toHaveBeenCalledWith(
      "run-1",
    );
  });

  it("returns null and logs a warning when the lookup throws", async () => {
    f.orchestrationService.findByLinkedWorkflowRun.mockRejectedValueOnce(
      new Error("db down"),
    );
    const result = await resolveProjectIdForWorkflowRun(
      f.terminalProjectionDeps,
      "run-1",
      null,
    );
    expect(result).toBeNull();
    expect(f.warn).toHaveBeenCalledWith(expect.stringContaining("db down"));
  });
});

describe("accrueWorkItemTokenSpend", () => {
  let f: MockFakes;

  beforeEach(() => {
    f = makeFakes();
  });

  it("is a no-op when workItemId is the orchestration-lifecycle marker", async () => {
    await accrueWorkItemTokenSpend(f.terminalProjectionDeps, {
      projectId: "project-1",
      workItemId: "__orchestration_lifecycle__",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "COMPLETED",
        usage: { total_tokens: 1000 },
      },
    });
    expect(f.workItems.addTokenSpend).not.toHaveBeenCalled();
    expect(f.workItems.addCostSpend).not.toHaveBeenCalled();
  });

  it("adds the token spend and cost when usage is present", async () => {
    await accrueWorkItemTokenSpend(f.terminalProjectionDeps, {
      projectId: "project-1",
      workItemId: "work-item-1",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "COMPLETED",
        usage: { total_tokens: 1500, estimated_cost_cents: 25 },
      },
    });
    expect(f.workItems.addTokenSpend).toHaveBeenCalledWith({
      project_id: "project-1",
      workItemId: "work-item-1",
      amount: 1500,
    });
    expect(f.workItems.addCostSpend).toHaveBeenCalledWith({
      project_id: "project-1",
      workItemId: "work-item-1",
      amountCents: 25,
    });
  });

  it("logs and continues when addTokenSpend throws", async () => {
    f.workItems.addTokenSpend.mockRejectedValueOnce(new Error("db down"));
    await accrueWorkItemTokenSpend(f.terminalProjectionDeps, {
      projectId: "project-1",
      workItemId: "work-item-1",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "COMPLETED",
        usage: { total_tokens: 1500 },
      },
    });
    expect(f.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to accrue token spend"),
    );
  });
});

describe("recordWorkItemRunCostAttempt", () => {
  let f: MockFakes;

  beforeEach(() => {
    f = makeFakes();
  });

  it("records a per-attempt row using the work item's current type, story points, priority, and the payload's model breakdown", async () => {
    f.workItems.findByProjectAndId.mockResolvedValueOnce({
      id: "work-item-1",
      type: "task",
      story_points: 3,
      priority: "p2",
    });

    await recordWorkItemRunCostAttempt(f.terminalProjectionDeps, {
      projectId: "project-1",
      workItemId: "work-item-1",
      workflowId: "workflow-1",
      runId: "run-1",
      payload: {
        run_id: "run-1",
        workflow_id: "workflow-1",
        status: "COMPLETED",
        usage: {
          total_tokens: 1234,
          input_tokens: 1000,
          output_tokens: 234,
          estimated_cost_cents: 12,
          priced_turn_count: 403,
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

    expect(f.workItemRunCosts.recordAttempt).toHaveBeenCalledWith({
      work_item_id: "work-item-1",
      run_id: "run-1",
      workflow_id: "workflow-1",
      type: "task",
      story_points: 3,
      priority: "p2",
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
      total_input_tokens: 1000,
      total_output_tokens: 234,
      total_cost_cents: 12,
      priced_turn_count: 403,
      started_at: null,
      completed_at: null,
    });
  });
});

describe("reconcileTerminalWorkflowRun", () => {
  let f: MockFakes;

  beforeEach(() => {
    f = makeFakes();
  });

  it("forwards the call to orchestrationService.reconcileLinkedWorkflowRun", async () => {
    await reconcileTerminalWorkflowRun(f.terminalWorkItemRunDeps, {
      projectId: "project-1",
      workflowRunId: "run-1",
      terminalStatus: "COMPLETED",
    });
    expect(
      f.orchestrationService.reconcileLinkedWorkflowRun,
    ).toHaveBeenCalledWith("project-1", {
      workflowRunId: "run-1",
      status: "COMPLETED",
    });
  });

  it("logs and returns undefined when reconcileLinkedWorkflowRun throws", async () => {
    f.orchestrationService.reconcileLinkedWorkflowRun.mockRejectedValueOnce(
      new Error("db down"),
    );
    const result = await reconcileTerminalWorkflowRun(
      f.terminalWorkItemRunDeps,
      {
        projectId: "project-1",
        workflowRunId: "run-1",
        terminalStatus: "FAILED",
      },
    );
    expect(result).toBeUndefined();
    expect(f.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to reconcile linked workflow run"),
    );
  });
});

describe("recordTerminalRepairEvidence", () => {
  let f: MockFakes;

  beforeEach(() => {
    f = makeFakes();
  });

  it("does nothing when the run is not a failed work item run", async () => {
    await recordTerminalRepairEvidence(f.terminalWorkItemRunDeps, {
      projectId: "project-1",
      workflowRunId: "run-1",
      workItemId: "work-item-1",
      terminalStatus: "FAILED",
      isFailedWorkItemRun: false,
    });
    expect(f.repairLane.recordFailedWorkItemRun).not.toHaveBeenCalled();
  });

  it("does nothing when terminalStatus is COMPLETED", async () => {
    await recordTerminalRepairEvidence(f.terminalWorkItemRunDeps, {
      projectId: "project-1",
      workflowRunId: "run-1",
      workItemId: "work-item-1",
      terminalStatus: "COMPLETED",
      isFailedWorkItemRun: true,
    });
    expect(f.repairLane.recordFailedWorkItemRun).not.toHaveBeenCalled();
  });

  it("does nothing when workItemId is undefined", async () => {
    await recordTerminalRepairEvidence(f.terminalWorkItemRunDeps, {
      projectId: "project-1",
      workflowRunId: "run-1",
      workItemId: undefined,
      terminalStatus: "FAILED",
      isFailedWorkItemRun: true,
    });
    expect(f.repairLane.recordFailedWorkItemRun).not.toHaveBeenCalled();
  });

  it("records a failed-work-item run with SystemFailure classification by default", async () => {
    await recordTerminalRepairEvidence(f.terminalWorkItemRunDeps, {
      projectId: "project-1",
      workflowRunId: "run-1",
      workItemId: "work-item-1",
      terminalStatus: "FAILED",
      isFailedWorkItemRun: true,
    });
    expect(f.repairLane.recordFailedWorkItemRun).toHaveBeenCalledWith({
      projectId: "project-1",
      workflowRunId: "run-1",
      workItemId: "work-item-1",
      status: "FAILED",
      failureClass: FailureClass.SystemFailure,
    });
  });

  it("records a failed-work-item run with QaRejection when the metadata carries qa_decision: reject", async () => {
    f.workItems.findByProjectAndId.mockResolvedValueOnce({
      id: "work-item-1",
      metadata: { qa_decision: "reject" },
    });
    await recordTerminalRepairEvidence(f.terminalWorkItemRunDeps, {
      projectId: "project-1",
      workflowRunId: "run-1",
      workItemId: "work-item-1",
      terminalStatus: "FAILED",
      isFailedWorkItemRun: true,
    });
    expect(f.repairLane.recordFailedWorkItemRun).toHaveBeenCalledWith({
      projectId: "project-1",
      workflowRunId: "run-1",
      workItemId: "work-item-1",
      status: "FAILED",
      failureClass: FailureClass.QaRejection,
    });
  });
});

describe("resolveWorkItemRunFailureClass", () => {
  let f: MockFakes;

  beforeEach(() => {
    f = makeFakes();
  });

  it("returns SystemFailure when the work item metadata does not carry qa_decision", async () => {
    f.workItems.findByProjectAndId.mockResolvedValueOnce({
      id: "work-item-1",
      metadata: { unrelated: "value" },
    });
    const result = await resolveWorkItemRunFailureClass(
      f.terminalProjectionDeps,
      { projectId: "project-1", workItemId: "work-item-1" },
    );
    expect(result).toBe(FailureClass.SystemFailure);
  });

  it("returns QaRejection when the metadata carries qa_decision: reject", async () => {
    f.workItems.findByProjectAndId.mockResolvedValueOnce({
      id: "work-item-1",
      metadata: { qa_decision: "reject" },
    });
    const result = await resolveWorkItemRunFailureClass(
      f.terminalProjectionDeps,
      { projectId: "project-1", workItemId: "work-item-1" },
    );
    expect(result).toBe(FailureClass.QaRejection);
  });

  it("returns SystemFailure conservatively when the metadata read fails", async () => {
    f.workItems.findByProjectAndId.mockRejectedValueOnce(new Error("db down"));
    const result = await resolveWorkItemRunFailureClass(
      f.terminalProjectionDeps,
      { projectId: "project-1", workItemId: "work-item-1" },
    );
    expect(result).toBe(FailureClass.SystemFailure);
    expect(f.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to read work item"),
    );
  });

  it("returns SystemFailure when the work item is not found", async () => {
    f.workItems.findByProjectAndId.mockResolvedValueOnce(null);
    const result = await resolveWorkItemRunFailureClass(
      f.terminalProjectionDeps,
      { projectId: "project-1", workItemId: "work-item-missing" },
    );
    expect(result).toBe(FailureClass.SystemFailure);
  });
});
