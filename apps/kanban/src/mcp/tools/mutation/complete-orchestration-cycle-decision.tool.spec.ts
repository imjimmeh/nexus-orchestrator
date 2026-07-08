import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { CoreWorkflowClientService } from "../../../core/core-workflow-client.service";
import { KanbanRetrospectiveEvidenceService } from "../../../retrospectives/kanban-retrospective-evidence.service";
import { BoardStateService } from "../../../services/board-state.service";
import {
  CompleteOrchestrationCycleDecisionTool,
  CompleteOrchestrationCycleDecisionInputSchema,
} from "./complete-orchestration-cycle-decision.tool";
import { OrchestrationRecordCycleDecisionTool } from "./orchestration-record-cycle-decision.tool";

interface MockRecordCycleDecisionTool {
  execute: ReturnType<typeof vi.fn>;
}

interface MockCoreWorkflowClient {
  setWorkflowJobOutput: ReturnType<typeof vi.fn>;
  emitDomainEvent: ReturnType<typeof vi.fn>;
  stepComplete: ReturnType<typeof vi.fn>;
}

interface MockEvidenceService {
  collectProjectEvidence: ReturnType<typeof vi.fn>;
}

interface MockBoardStateService {
  createBoardStateSnapshot: ReturnType<typeof vi.fn>;
  storeBoardStateSnapshot: ReturnType<typeof vi.fn>;
  detectBoardMutation: ReturnType<typeof vi.fn>;
  getBoardStateSummary: ReturnType<typeof vi.fn>;
}

describe("CompleteOrchestrationCycleDecisionTool", () => {
  const context: InternalToolExecutionContext = {
    workflowRunId: "run-1",
    jobId: "ceo_orchestration_decision",
  };

  function createRecordTool(): MockRecordCycleDecisionTool {
    return {
      execute: vi.fn().mockResolvedValue({
        ok: true,
        project_id: "project-1",
        decision: "repeat",
        reason: "Safe repeat after reviewing candidates",
        persisted: true,
        duplicate: false,
      }),
    };
  }

  function createCoreClient(): MockCoreWorkflowClient {
    return {
      setWorkflowJobOutput: vi.fn().mockResolvedValue({ ok: true }),
      emitDomainEvent: vi.fn().mockResolvedValue({ ok: true }),
      stepComplete: vi.fn().mockResolvedValue({ ok: true }),
    };
  }

  function createEvidenceService(): MockEvidenceService {
    return {
      collectProjectEvidence: vi.fn().mockResolvedValue({
        state: "ready",
        deltaSnapshot: {
          workItems: {
            total: 5,
            countsByStatus: { todo: 3, done: 2 },
          },
        },
      }),
    };
  }

  function createBoardStateService(
    mutationDetected = true,
  ): MockBoardStateService {
    return {
      createBoardStateSnapshot: vi.fn().mockResolvedValue({
        timestamp: new Date(),
        projectId: "project-1",
        tasks: new Map(),
        columns: new Map(),
      }),
      storeBoardStateSnapshot: vi.fn(),
      detectBoardMutation: vi
        .fn()
        .mockResolvedValue({ hasMutations: mutationDetected }),
      getBoardStateSummary: vi.fn().mockResolvedValue({
        workItems: {
          total: 17,
          countsByStatus: { todo: 5, in_progress: 3, done: 8, blocked: 1 },
        },
        goals: {
          total: 3,
          countsByStatus: { active: 2, completed: 1 },
        },
      }),
    };
  }

  function createTool(overrides?: {
    recordTool?: MockRecordCycleDecisionTool;
    coreClient?: MockCoreWorkflowClient;
    evidenceService?: MockEvidenceService;
    boardStateService?: MockBoardStateService;
  }): {
    tool: CompleteOrchestrationCycleDecisionTool;
    recordTool: MockRecordCycleDecisionTool;
    coreClient: MockCoreWorkflowClient;
    evidenceService: MockEvidenceService;
    boardStateService: MockBoardStateService;
  } {
    const recordTool = overrides?.recordTool ?? createRecordTool();
    const coreClient = overrides?.coreClient ?? createCoreClient();
    const evidenceService =
      overrides?.evidenceService ?? createEvidenceService();
    const boardStateService =
      overrides?.boardStateService ?? createBoardStateService();
    return {
      recordTool,
      coreClient,
      evidenceService,
      boardStateService,
      tool: new CompleteOrchestrationCycleDecisionTool(
        recordTool as unknown as OrchestrationRecordCycleDecisionTool,
        coreClient as unknown as CoreWorkflowClientService,
        evidenceService as unknown as KanbanRetrospectiveEvidenceService,
        boardStateService as unknown as BoardStateService,
      ),
    };
  }

  it("has the composite tool name from getName and getDefinition", () => {
    const { tool } = createTool();

    expect(tool.getName()).toBe("kanban.complete_orchestration_cycle_decision");
    expect(tool.getDefinition()).toMatchObject({
      name: "kanban.complete_orchestration_cycle_decision",
      tierRestriction: 2,
      transport: "runner_local",
      runtimeOwner: "runner",
      inputSchema: CompleteOrchestrationCycleDecisionInputSchema,
    });
  });

  it("records the cycle decision and mirrors the safe decision into job output", async () => {
    const { tool, recordTool, coreClient } = createTool();

    const result = await tool.execute(context, {
      project_id: "project-1",
      decision: "blocked",
      reason: "Requested blocked but service may rewrite",
      idempotency_key: "cycle-1",
    });

    expect(recordTool.execute).toHaveBeenCalledWith(context, {
      project_id: "project-1",
      decision: "blocked",
      reason: "Requested blocked but service may rewrite",
      idempotency_key: "cycle-1",
    });
    expect(coreClient.setWorkflowJobOutput).toHaveBeenCalledWith({
      workflowRunId: "run-1",
      jobId: "ceo_orchestration_decision",
      data: {
        decision: "repeat",
        decision_reason: "Safe repeat after reviewing candidates",
        linked_run_id: "run-1",
      },
    });
    expect(result).toMatchObject({
      ok: true,
      project_id: "project-1",
      decision: "repeat",
      linked_run_id: "run-1",
      output_written: true,
      output_fields: ["decision", "decision_reason", "linked_run_id"],
      next_action: "call_step_complete",
      step_complete_called: false,
      isSubstantive: true,
    });
    expect(coreClient.stepComplete).not.toHaveBeenCalled();
  });

  it("does not call Core step_complete because the runner must complete with agent context", async () => {
    const coreClient = createCoreClient();
    coreClient.stepComplete.mockRejectedValue(
      new Error("HTTP 400 Bad Request for step complete"),
    );
    const { tool } = createTool({ coreClient });

    await expect(
      tool.execute(context, {
        project_id: "project-1",
        decision: "repeat",
        reason: "Safe repeat after reviewing candidates",
        idempotency_key: "cycle-1",
      }),
    ).resolves.toMatchObject({
      output_written: true,
      next_action: "call_step_complete",
      step_complete_called: false,
    });
    expect(coreClient.stepComplete).not.toHaveBeenCalled();
  });

  it("mirrors duplicate decision results to satisfy output contracts on retry", async () => {
    const recordTool = createRecordTool();
    recordTool.execute.mockResolvedValue({
      ok: true,
      project_id: "project-1",
      decision: "complete",
      reason: "Duplicate complete",
      persisted: false,
      duplicate: true,
    });
    const { tool, coreClient } = createTool({ recordTool });

    const result = await tool.execute(context, {
      project_id: "project-1",
      decision: "complete",
      reason: "Duplicate complete",
      idempotency_key: "cycle-duplicate",
    });

    expect(coreClient.setWorkflowJobOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          decision: "complete",
          decision_reason: "Duplicate complete",
          linked_run_id: "run-1",
        },
      }),
    );
    expect(result).toMatchObject({
      duplicate: true,
      output_written: true,
      isSubstantive: false,
    });
  });

  it("requires workflow run and job context before recording the decision", async () => {
    const { tool, recordTool, coreClient } = createTool();

    await expect(
      tool.execute(
        { workflowRunId: "run-1" },
        {
          project_id: "project-1",
          decision: "repeat",
          reason: "Work remains",
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(recordTool.execute).not.toHaveBeenCalled();
    expect(coreClient.setWorkflowJobOutput).not.toHaveBeenCalled();
  });

  it("does not expose workflow_run_id or job_id in the tool schema", () => {
    const schemaJson =
      CompleteOrchestrationCycleDecisionInputSchema.toJSONSchema() as {
        properties?: Record<string, unknown>;
      };

    expect(schemaJson.properties).not.toHaveProperty("workflow_run_id");
    expect(schemaJson.properties).not.toHaveProperty("job_id");
    expect(schemaJson.properties).not.toHaveProperty("step_id");
  });

  it("derives project_id from context.scopeId when not provided in params", async () => {
    const { tool, recordTool, coreClient } = createTool();

    const result = await tool.execute(
      {
        workflowRunId: "run-1",
        jobId: "job-1",
        scopeId: "project-from-context",
      },
      {
        decision: "repeat",
        reason: "Auto-resolved project",
      } as never,
    );

    expect(recordTool.execute).toHaveBeenCalledWith(
      expect.objectContaining({ scopeId: "project-from-context" }),
      expect.objectContaining({ project_id: "project-from-context" }),
    );
    expect(result).toMatchObject({
      ok: true,
      project_id: "project-from-context",
    });
  });

  it("throws with helpful message when project_id and scopeId are both missing", async () => {
    const { tool, recordTool, coreClient } = createTool();

    await expect(
      tool.execute({ workflowRunId: "run-1", jobId: "job-1" }, {
        decision: "repeat",
        reason: "No project",
      } as never),
    ).rejects.toThrow(
      /kanban\.complete_orchestration_cycle_decision requires project_id/,
    );

    expect(recordTool.execute).not.toHaveBeenCalled();
    expect(coreClient.setWorkflowJobOutput).not.toHaveBeenCalled();
  });

  it("resolves through Nest DI constructor injection", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CompleteOrchestrationCycleDecisionTool,
        {
          provide: OrchestrationRecordCycleDecisionTool,
          useFactory: () => createRecordTool(),
        },
        {
          provide: CoreWorkflowClientService,
          useFactory: () => createCoreClient(),
        },
        {
          provide: KanbanRetrospectiveEvidenceService,
          useFactory: () => createEvidenceService(),
        },
        {
          provide: BoardStateService,
          useFactory: () => createBoardStateService(),
        },
      ],
    }).compile();

    expect(
      moduleRef.get(CompleteOrchestrationCycleDecisionTool),
    ).toBeInstanceOf(CompleteOrchestrationCycleDecisionTool);
  });
});
