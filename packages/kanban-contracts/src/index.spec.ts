import { describe, expect, it } from "vitest";

import {
  KanbanWorkItemEventEnvelopeV1Schema,
  ProjectGoalSchema,
  ProjectGoalWorklogSchema,
  ProjectOrchestrationActionRequestListItemSchema,
  ProjectOrchestrationDecisionEntrySchema,
  ProjectOrchestrationStateSchema,
  ProjectRecordSchema,
  ProjectReviewDecisionInputSchema,
  StartOrchestrationInputSchema,
  WorkItemSchema,
  WorkItemRecordSchema,
} from "./index";

describe("kanban contract schemas", () => {
  it("parses representative project and goal contracts", () => {
    expect(
      ProjectRecordSchema.parse({
        id: "project-1",
        name: "Nexus",
        goals: "Ship kanban cutover",
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:01:00.000Z",
      }),
    ).toMatchObject({ id: "project-1" });

    expect(
      ProjectGoalSchema.parse({
        id: "goal-1",
        project_id: "project-1",
        title: "Extract contracts",
        description: null,
        status: "todo",
        moscow: "must",
        priority: "p0",
        sortOrder: 1,
        targetDate: null,
        completedAt: null,
        ownerAgentProfileId: null,
        metadata: null,
        isArchived: false,
        created_at: "2026-04-29T00:00:00.000Z",
        updated_at: "2026-04-29T00:01:00.000Z",
      }),
    ).toMatchObject({ project_id: "project-1" });
    expect(
      ProjectGoalWorklogSchema.parse({
        id: "worklog-1",
        goalId: "goal-1",
        project_id: "project-1",
        workItemId: "work-item-1",
        entryType: "note",
        authorType: "user",
        authorId: "user-1",
        authorName: "Reviewer",
        note: "Looks good",
        linkedRunId: null,
        metadata: null,
        created_at: "2026-04-29T00:00:00.000Z",
        updated_at: "2026-04-29T00:01:00.000Z",
      }),
    ).toMatchObject({ workItemId: "work-item-1" });
  });

  it("parses representative work-item, review, orchestration, and event contracts", () => {
    const workItem = WorkItemRecordSchema.parse({
      id: "work-item-1",
      project_id: "project-1",
      title: "Add shared contracts",
      description: "Keep persistence unchanged",
      status: "in-progress",
      type: "story",
      priority: "p1",
      assignedAgentId: null,
      tokenSpend: 0,
      currentExecutionId: null,
      waitingForInput: false,
      executionConfig: {
        baseBranch: "main",
        targetBranch: "feature/contracts",
        contextFiles: [],
        documentationUrls: [],
      },
      metadata: { source: "epic-150" },
      lastExecutionStatus: null,
      dependsOn: [],
      blockedBy: [],
      createdAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:01:00.000Z",
      linkedRunId: null,
    });

    expect(workItem.status).toBe("in-progress");
    expect(
      WorkItemSchema.parse({
        id: "work-item-web-1",
        project_id: "project-1",
        title: "Render shared DTO",
        description: null,
        status: "todo",
        type: "story",
        priority: "p1",
        assignedAgentId: null,
        tokenSpend: 0,
        currentExecutionId: null,
        waitingForInput: false,
        executionConfig: {
          baseBranch: "main",
          targetBranch: "feature/contracts",
          contextFiles: [],
          documentationUrls: [],
        },
        metadata: null,
        lastExecutionStatus: null,
        dependsOn: [],
        blocks: [],
        blockers: [],
        subtasks: [],
        created_at: "2026-04-29T00:00:00.000Z",
        updated_at: "2026-04-29T00:01:00.000Z",
      }),
    ).toMatchObject({ id: "work-item-web-1" });
    expect(
      ProjectReviewDecisionInputSchema.parse({
        decision: "approve",
        workflowId: "workflow-1",
        requestedBy: "reviewer",
      }),
    ).toMatchObject({ decision: "approve" });
    expect(
      StartOrchestrationInputSchema.parse({
        goals: "Deliver cutover contracts",
        workflowId: "workflow-1",
        requestedBy: "architect",
        orchestrationMode: "supervised",
      }),
    ).toMatchObject({ orchestrationMode: "supervised" });
    expect(
      StartOrchestrationInputSchema.parse({
        goals: "Deliver cutover contracts",
        orchestrationMode: "supervised",
      }),
    ).toMatchObject({ orchestrationMode: "supervised" });
    expect(
      ProjectOrchestrationActionRequestListItemSchema.parse({
        id: "action-1",
        project_id: "project-1",
        action: "dispatch_start_work_items",
        payload: null,
        workflowRunId: null,
        modeAtRequest: "supervised",
        requestedBy: null,
        status: "pending",
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
        executedAt: null,
        errorMessage: null,
        correlationId: "corr-1",
        projectName: "Nexus",
        workflowId: "workflow-1",
        created_at: "2026-04-29T00:00:00.000Z",
        updated_at: "2026-04-29T00:01:00.000Z",
      }),
    ).toMatchObject({ projectName: "Nexus" });
    expect(
      ProjectOrchestrationDecisionEntrySchema.parse({
        timestamp: "2026-04-29T00:02:00.000Z",
        type: "cycle_decision",
        reasoning: "Ready work remains",
        actions: ["repeat"],
        cycleDecision: "repeat",
        idempotencyKey: "cycle-repeat-project-1-run-1",
        autonomousDefault: true,
        readyWorkRemaining: true,
      }),
    ).toMatchObject({ cycleDecision: "repeat" });
    expect(
      ProjectOrchestrationStateSchema.parse({
        orchestration: {
          id: "orchestration-1",
          project_id: "project-1",
          status: "orchestrating",
          goals: "Deliver cutover contracts",
          revisionFeedback: null,
          orchestrationMode: "supervised",
          strategySummary: null,
          currentWorkflowRunId: null,
          decisionLog: [],
          metadata: null,
          probe_results: {
            "web-ui": {
              outcome: "success",
              result: { inferred_status: "implemented" },
            },
          },
          created_at: "2026-04-29T00:00:00.000Z",
          updated_at: "2026-04-29T00:01:00.000Z",
        },
        projectState: {
          project_id: "project-1",
          totalCount: 1,
          activeCount: 1,
          groupedByStatus: {
            todo: [
              {
                id: "work-item-1",
                title: "Cut contracts",
                status: "todo",
                priority: "p1",
                dependsOn: [],
                blocks: [],
                blockers: [],
              },
            ],
          },
        },
        pendingActionRequests: [],
      }),
    ).toMatchObject({
      orchestration: { probe_results: { "web-ui": expect.any(Object) } },
      projectState: { project_id: "project-1" },
    });
    expect(
      KanbanWorkItemEventEnvelopeV1Schema.parse({
        eventId: "evt-1",
        eventType: "kanban.work_item.status_changed.v1",
        eventVersion: "v1",
        occurredAt: "2026-04-29T00:02:00.000Z",
        correlationId: "corr-1",
        sourceService: "kanban",
        payload: {
          event: "kanban.work_item.status_changed.v1",
          scopeId: "project-1",
          contextId: "work-item-1",
          workItemId: "work-item-1",
          status: "in-progress",
          previousStatus: "todo",
          actor: "system",
          resource: {
            id: "work-item-1",
            project_id: "project-1",
            title: "Cut contracts",
            status: "in-progress",
            type: "story",
            executionConfig: {
              baseBranch: "main",
              targetBranch: "feature/contracts",
              specPath: "docs/specs/contracts.md",
            },
            metadata: { refinement: { hasClearedRefinementOnce: false } },
            dependsOn: [],
            blockedBy: [],
            subtasks: [],
            createdAt: "2026-04-29T00:00:00.000Z",
            updatedAt: "2026-04-29T00:02:00.000Z",
            linkedRunId: null,
          },
        },
      }),
    ).toMatchObject({
      eventType: "kanban.work_item.status_changed.v1",
      payload: {
        event: "kanban.work_item.status_changed.v1",
        workItemId: "work-item-1",
        actor: "system",
        resource: {
          type: "story",
          executionConfig: { targetBranch: "feature/contracts" },
        },
      },
    });

    expect(() =>
      KanbanWorkItemEventEnvelopeV1Schema.parse({
        eventId: "evt-incomplete-status",
        eventType: "kanban.work_item.status_changed.v1",
        eventVersion: "v1",
        occurredAt: "2026-04-29T00:02:00.000Z",
        correlationId: "corr-1",
        sourceService: "kanban",
        payload: {
          scopeId: "project-1",
          contextId: "work-item-1",
          status: "in-progress",
          previousStatus: "todo",
        },
      }),
    ).toThrow();

    const canonicalStatusEventEnvelope = {
      eventId: "evt-invalid-status",
      eventType: "kanban.work_item.status_changed.v1",
      eventVersion: "v1",
      occurredAt: "2026-04-29T00:02:00.000Z",
      correlationId: "corr-1",
      sourceService: "kanban",
      payload: {
        event: "kanban.work_item.status_changed.v1",
        scopeId: "project-1",
        contextId: "work-item-1",
        workItemId: "work-item-1",
        status: "in-progress",
        previousStatus: "todo",
        actor: "system",
        resource: {
          id: "work-item-1",
          project_id: "project-1",
          title: "Cut contracts",
          status: "in-progress",
          type: "story",
          executionConfig: {
            baseBranch: "main",
            targetBranch: "feature/contracts",
          },
          metadata: null,
          dependsOn: [],
          blockedBy: [],
          subtasks: [],
          createdAt: "2026-04-29T00:00:00.000Z",
          updatedAt: "2026-04-29T00:02:00.000Z",
          linkedRunId: null,
        },
      },
    };

    expect(() =>
      KanbanWorkItemEventEnvelopeV1Schema.parse({
        ...canonicalStatusEventEnvelope,
        payload: {
          ...canonicalStatusEventEnvelope.payload,
          status: "invalid-status",
        },
      }),
    ).toThrow();

    expect(() =>
      KanbanWorkItemEventEnvelopeV1Schema.parse({
        ...canonicalStatusEventEnvelope,
        payload: {
          ...canonicalStatusEventEnvelope.payload,
          previousStatus: "invalid-status",
        },
      }),
    ).toThrow();

    expect(
      KanbanWorkItemEventEnvelopeV1Schema.parse({
        ...canonicalStatusEventEnvelope,
        eventId: "evt-null-previous-status",
        payload: {
          ...canonicalStatusEventEnvelope.payload,
          previousStatus: null,
        },
      }),
    ).toMatchObject({
      payload: {
        previousStatus: null,
      },
    });
  });
});
