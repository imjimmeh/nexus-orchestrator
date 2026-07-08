import { KanbanWorkItemEventEnvelopeV1Schema } from "@nexus/kanban-contracts";
import { describe, expect, it } from "vitest";

describe("kanban contract stub", () => {
  it("parses a shared kanban work-item event envelope", () => {
    const parsed = KanbanWorkItemEventEnvelopeV1Schema.parse({
      eventId: "evt-kanban-stub",
      eventType: "kanban.work_item.status_changed.v1",
      eventVersion: "v1",
      occurredAt: "2026-04-13T00:00:00.000Z",
      correlationId: "corr-kanban-stub",
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
          title: "Implement workflow event wakeups",
          status: "in-progress",
          type: "story",
          executionConfig: {
            baseBranch: "main",
            targetBranch: "feature/event-wakeups",
          },
          metadata: null,
          dependsOn: [],
          blockedBy: [],
          subtasks: [],
          createdAt: "2026-04-13T00:00:00.000Z",
          updatedAt: "2026-04-13T00:01:00.000Z",
          linkedRunId: null,
        },
      },
    });

    expect(parsed.payload).toMatchObject({
      contextId: "work-item-1",
      resource: {
        executionConfig: {
          targetBranch: "feature/event-wakeups",
        },
      },
    });
  });
});
