import { describe, expect, it, vi } from "vitest";
import type { ImprovementTaskRequestedV1 } from "@nexus/core";
import { CoreLifecycleStreamImprovementTaskHandler } from "./core-lifecycle-stream-improvement-task.handler";
import { ImprovementTaskParkedError } from "./core-lifecycle-stream-improvement-task.helpers";

const payload: ImprovementTaskRequestedV1 = {
  proposalId: "11111111-0000-4000-8000-000000000002",
  title: "Fix NUL-byte handling in outbox insert",
  description: "NUL bytes abort the outbox INSERT and wedge the run.",
  suspectedArea: ["apps/api/src/outbox"],
  evidence: {
    runIds: ["run-1"],
    failureClasses: ["outbox_insert_failed"],
    ledgerRefs: [],
  },
  severity: "critical",
  occurrenceCount: 2,
};

function buildHandler(options: { projectId: string; existing?: unknown }) {
  const settings = { get: vi.fn().mockResolvedValue(options.projectId) };
  const workItems = {
    findByProjectAndId: vi.fn().mockResolvedValue(options.existing ?? null),
  };
  const workItemService = {
    createWorkItem: vi.fn().mockResolvedValue({ id: payload.proposalId }),
  };
  const handler = new CoreLifecycleStreamImprovementTaskHandler(
    settings as never,
    workItemService as never,
    workItems as never,
  );
  return { handler, settings, workItems, workItemService };
}

describe("CoreLifecycleStreamImprovementTaskHandler", () => {
  it("creates a work item on the configured project mapped from the brief", async () => {
    const { handler, workItemService } = buildHandler({ projectId: "proj-1" });

    await handler.handle(payload);

    expect(workItemService.createWorkItem).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        id: payload.proposalId,
        title: payload.title,
        priority: "p0",
        status: "backlog",
        metadata: {
          improvement: expect.objectContaining({
            proposalId: payload.proposalId,
            severity: "critical",
            occurrenceCount: 2,
            suspectedArea: payload.suspectedArea,
            evidence: payload.evidence,
          }),
        },
      }),
    );
    const input = workItemService.createWorkItem.mock.calls[0][1];
    expect(input.description).toContain("outbox_insert_failed");
  });

  it("parks with ImprovementTaskParkedError when no project is configured", async () => {
    const { handler, workItemService } = buildHandler({ projectId: "" });

    await expect(handler.handle(payload)).rejects.toBeInstanceOf(
      ImprovementTaskParkedError,
    );
    expect(workItemService.createWorkItem).not.toHaveBeenCalled();
  });

  it("skips filing when a work item for the proposal already exists", async () => {
    const { handler, workItemService } = buildHandler({
      projectId: "proj-1",
      existing: { id: payload.proposalId },
    });

    await handler.handle(payload);

    expect(workItemService.createWorkItem).not.toHaveBeenCalled();
  });
});
