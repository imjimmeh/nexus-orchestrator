import type {
  CreateWorkItemInput,
  WorkItemRecord,
} from "@nexus/kanban-contracts";
import { vi } from "vitest";
import type {
  ImportedRepositoryBacklogReconciliationPlan,
  RepositoryWorkItemSpec,
} from "./imported-repository-backlog-reconciler";
import { ReconciledWorkItemPublisher } from "./reconciled-work-item-publisher";
import { WorkItemService } from "../work-item/work-item.service";

export type { RepositoryWorkItemSpec };

type WorkItemServiceMock = {
  listWorkItems: ReturnType<
    typeof vi.fn<(projectId: string) => Promise<WorkItemRecord[]>>
  >;
  createWorkItem: ReturnType<
    typeof vi.fn<
      (projectId: string, input: CreateWorkItemInput) => Promise<WorkItemRecord>
    >
  >;
  updateWorkItem: ReturnType<
    typeof vi.fn<
      (
        projectId: string,
        workItemId: string,
        data: Record<string, unknown>,
      ) => Promise<WorkItemRecord>
    >
  >;
  updateStatus: ReturnType<
    typeof vi.fn<
      (
        projectId: string,
        workItemId: string,
        status: string,
      ) => Promise<WorkItemRecord>
    >
  >;
  dispatchWorkItem: ReturnType<
    typeof vi.fn<() => Promise<Record<string, never>>>
  >;
  submitReviewDecision: ReturnType<
    typeof vi.fn<() => Promise<Record<string, never>>>
  >;
  requestMerge: ReturnType<typeof vi.fn<() => Promise<Record<string, never>>>>;
};

export function makeSpec(
  overrides: Partial<RepositoryWorkItemSpec> = {},
): RepositoryWorkItemSpec {
  return {
    sourceId: "imported-repo:project-1:existing_capability:workflow-runtime",
    status: "todo",
    workType: "existing_capability",
    title: "workflow-runtime",
    reason: "Capability exists with high confidence.",
    evidence: {
      artifactPath: "probes/workflow-runtime.md",
      probeScopeId: "workflow-runtime",
      evidenceRefs: ["apps/api/src/workflow/workflow-runtime.module.ts"],
      sourcePaths: ["apps/api/src/workflow/workflow-runtime"],
      confidenceScore: 0.95,
      projectScopeId: "project-1",
      outcome: "success",
      inferredStatus: "implemented",
      narrativeSummary: "Workflow runtime module is fully implemented.",
    },
    metadata: {
      sourceHash: "abc123def456",
    },
    ...overrides,
  };
}

export function makePlan(
  specs: RepositoryWorkItemSpec[],
): ImportedRepositoryBacklogReconciliationPlan {
  return {
    specs,
    findings: specs,
    counts: {
      total: specs.length,
      done: specs.filter((s) => s.status === "done").length,
      todo: specs.filter((s) => s.status === "todo").length,
      blocked: specs.filter((s) => s.status === "blocked").length,
    },
    summary: `Reconciled ${specs.length} specs`,
    diagnostics: {
      artifactCount: specs.length,
      mappedSpecs: specs.length,
      mappedFindings: specs.length,
    },
    cycleDecision: {
      decision: "complete",
      reason: "All specs resolved",
      readyForCycle: true,
    },
    openQuestions: [],
  };
}

export function makeWorkItemRecord(
  overrides: Partial<WorkItemRecord> = {},
): WorkItemRecord {
  return {
    id: "wi-1",
    project_id: "project-1",
    title: "workflow-runtime",
    description: null,
    status: "todo",
    type: "story",
    priority: "p2",
    assignedAgentId: null,
    tokenSpend: 0,
    currentExecutionId: null,
    waitingForInput: false,
    executionConfig: null,
    metadata: null,
    dependsOn: [],
    blockedBy: [],
    subtasks: [],
    createdAt: "2026-04-15T00:00:00.000Z",
    updatedAt: "2026-04-15T00:00:00.000Z",
    linkedRunId: null,
    ...overrides,
  };
}

export function setupPublisherTest(): {
  publisher: ReconciledWorkItemPublisher;
  mockPort: WorkItemServiceMock;
} {
  const mockPort: WorkItemServiceMock = {
    listWorkItems: vi
      .fn<(projectId: string) => Promise<WorkItemRecord[]>>()
      .mockResolvedValue([]),
    createWorkItem: vi
      .fn<
        (
          projectId: string,
          input: CreateWorkItemInput,
        ) => Promise<WorkItemRecord>
      >()
      .mockImplementation((projectId, input) =>
        Promise.resolve(
          makeWorkItemRecord({
            id: "wi-new",
            project_id: projectId,
            status: input.status ?? "todo",
            metadata: input.metadata ?? null,
          }),
        ),
      ),
    updateWorkItem: vi
      .fn<
        (
          projectId: string,
          workItemId: string,
          data: Record<string, unknown>,
        ) => Promise<WorkItemRecord>
      >()
      .mockImplementation((projectId, workItemId, patch) =>
        Promise.resolve(
          makeWorkItemRecord({
            id: workItemId,
            project_id: projectId,
            metadata: (patch.metadata as Record<string, unknown>) ?? null,
          }),
        ),
      ),
    updateStatus: vi
      .fn<
        (
          projectId: string,
          workItemId: string,
          status: string,
        ) => Promise<WorkItemRecord>
      >()
      .mockImplementation((projectId, workItemId, status) =>
        Promise.resolve(
          makeWorkItemRecord({
            id: workItemId,
            project_id: projectId,
            status: status as WorkItemRecord["status"],
          }),
        ),
      ),
    dispatchWorkItem: vi
      .fn<() => Promise<Record<string, never>>>()
      .mockResolvedValue({}),
    submitReviewDecision: vi
      .fn<() => Promise<Record<string, never>>>()
      .mockResolvedValue({}),
    requestMerge: vi
      .fn<() => Promise<Record<string, never>>>()
      .mockResolvedValue({}),
  };

  return {
    mockPort,
    publisher: new ReconciledWorkItemPublisher(
      mockPort as unknown as WorkItemService,
    ),
  };
}
