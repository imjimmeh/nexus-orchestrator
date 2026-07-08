import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import { ReconciledWorkItemPublisher } from "./reconciled-work-item-publisher";
import {
  makePlan,
  makeSpec,
  makeWorkItemRecord,
  setupPublisherTest,
  type RepositoryWorkItemSpec,
} from "./reconciled-work-item-publisher.spec-helpers";

describe("ReconciledWorkItemPublisher", () => {
  let publisher: ReconciledWorkItemPublisher;
  let mockPort: ReturnType<typeof setupPublisherTest>["mockPort"];

  beforeEach(() => {
    ({ publisher, mockPort } = setupPublisherTest());
  });
  describe("missing sourceId creates a work item with reconciliation metadata", () => {
    it("creates a new work item when no existing item matches sourceId", async () => {
      mockPort.listWorkItems.mockResolvedValue([]);
      const spec = makeSpec();
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.created).toBe(1);
      expect(result.counts.updated).toBe(0);
      expect(result.counts.unchanged).toBe(0);
      expect(mockPort.createWorkItem).toHaveBeenCalledTimes(1);

      const [projectId, input] = mockPort.createWorkItem.mock.calls[0];
      expect(projectId).toBe("project-1");
      expect(input.title).toBe(spec.title);
      expect(input.status).toBe("todo");

      const metadata = input.metadata as Record<string, unknown>;
      expect(metadata.importedRepoReconciliation).toBe(true);
      expect(metadata.sourceId).toBe(spec.sourceId);
      expect(metadata.sourceHash).toBe(spec.metadata.sourceHash);
      expect(metadata.workType).toBe(spec.workType);
      expect(metadata.evidence).toEqual(spec.evidence);
      expect(metadata.reason).toBe(spec.reason);
    });

    it("returns a per-item outcome with action=created and the work item id", async () => {
      mockPort.listWorkItems.mockResolvedValue([]);
      const spec = makeSpec();
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.outcomes).toHaveLength(1);
      expect(result.outcomes[0]).toEqual({
        sourceId: spec.sourceId,
        action: "created",
        workItemId: "wi-new",
      });
    });
  });

  describe("matching sourceId with changed sourceHash updates instead of duplicating", () => {
    it("updates an existing work item when sourceHash differs", async () => {
      const existingItem = makeWorkItemRecord({
        id: "wi-existing",
        metadata: {
          importedRepoReconciliation: true,
          sourceId:
            "imported-repo:project-1:existing_capability:workflow-runtime",
          sourceHash: "old-hash",
          workType: "existing_capability",
          evidence: {},
          reason: "old reason",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existingItem]);

      const spec = makeSpec({ metadata: { sourceHash: "new-hash" } });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(result.counts.created).toBe(0);
      expect(result.counts.unchanged).toBe(0);
      expect(mockPort.updateWorkItem).toHaveBeenCalledTimes(1);
      expect(mockPort.createWorkItem).not.toHaveBeenCalled();

      const [projectId, workItemId, data] =
        mockPort.updateWorkItem.mock.calls[0];
      expect(projectId).toBe("project-1");
      expect(workItemId).toBe("wi-existing");

      const patch = data;
      const metadata = patch.metadata as Record<string, unknown>;
      expect(metadata.sourceHash).toBe("new-hash");
      expect(metadata.importedRepoReconciliation).toBe(true);
      expect(metadata.sourceId).toBe(spec.sourceId);
      expect(metadata.workType).toBe(spec.workType);
      expect(metadata.evidence).toEqual(spec.evidence);
      expect(metadata.reason).toBe(spec.reason);
    });

    it("returns a per-item outcome with action=updated and the existing work item id", async () => {
      const existingItem = makeWorkItemRecord({
        id: "wi-existing",
        metadata: {
          importedRepoReconciliation: true,
          sourceId:
            "imported-repo:project-1:existing_capability:workflow-runtime",
          sourceHash: "old-hash",
          workType: "existing_capability",
          evidence: {},
          reason: "",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existingItem]);

      const spec = makeSpec({ metadata: { sourceHash: "new-hash" } });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.outcomes).toHaveLength(1);
      expect(result.outcomes[0]).toEqual({
        sourceId: spec.sourceId,
        action: "updated",
        workItemId: "wi-existing",
      });
    });
  });

  describe("matching sourceId with same sourceHash counts as unchanged", () => {
    it("does not create or update when sourceHash matches", async () => {
      const existingItem = makeWorkItemRecord({
        id: "wi-existing",
        metadata: {
          importedRepoReconciliation: true,
          sourceId:
            "imported-repo:project-1:existing_capability:workflow-runtime",
          sourceHash: "abc123def456",
          workType: "existing_capability",
          lastGeneratedStatus: "todo",
          lastGeneratedWorkType: "existing_capability",
          generatedRecommendation: "todo",
          evidence: {},
          reason: "old reason",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existingItem]);

      const spec = makeSpec();
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.unchanged).toBe(1);
      expect(result.counts.created).toBe(0);
      expect(result.counts.updated).toBe(0);
      expect(mockPort.createWorkItem).not.toHaveBeenCalled();
      expect(mockPort.updateWorkItem).not.toHaveBeenCalled();
    });

    it("returns a per-item outcome with action=unchanged and the existing work item id", async () => {
      const existingItem = makeWorkItemRecord({
        id: "wi-existing",
        metadata: {
          importedRepoReconciliation: true,
          sourceId:
            "imported-repo:project-1:existing_capability:workflow-runtime",
          sourceHash: "abc123def456",
          workType: "existing_capability",
          lastGeneratedStatus: "todo",
          lastGeneratedWorkType: "existing_capability",
          generatedRecommendation: "todo",
          evidence: {},
          reason: "",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existingItem]);

      const spec = makeSpec();
      const plan = makePlan([spec]);
      const result = await publisher.publish(plan, "project-1");

      expect(result.outcomes).toHaveLength(1);
      expect(result.outcomes[0]).toEqual({
        sourceId: spec.sourceId,
        action: "unchanged",
        workItemId: "wi-existing",
      });
    });
  });

  describe("done imported-reality items are created through createWorkItem only", () => {
    it("creates done items without calling dispatch/review/merge APIs", async () => {
      mockPort.listWorkItems.mockResolvedValue([]);
      const doneSpec = makeSpec({ status: "done" });
      const plan = makePlan([doneSpec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.created).toBe(1);
      expect(mockPort.createWorkItem).toHaveBeenCalledTimes(1);

      const [, input] = mockPort.createWorkItem.mock.calls[0];
      expect(input.status).toBe("done");

      expect(mockPort.dispatchWorkItem).not.toHaveBeenCalled();
      expect(mockPort.submitReviewDecision).not.toHaveBeenCalled();
      expect(mockPort.requestMerge).not.toHaveBeenCalled();
    });
  });

  describe("status reconciliation during update", () => {
    it("calls updateStatus when existing item has a different status than the spec", async () => {
      const existingItem = makeWorkItemRecord({
        id: "wi-existing",
        status: "in-progress",
        metadata: {
          importedRepoReconciliation: true,
          sourceId:
            "imported-repo:project-1:existing_capability:workflow-runtime",
          sourceHash: "old-hash",
          workType: "existing_capability",
          evidence: {},
          reason: "",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existingItem]);

      const spec = makeSpec({
        status: "blocked",
        metadata: { sourceHash: "new-hash" },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(mockPort.updateStatus).toHaveBeenCalledTimes(1);
      expect(mockPort.updateStatus).toHaveBeenCalledWith(
        "project-1",
        "wi-existing",
        "blocked",
      );
      expect(mockPort.updateWorkItem).toHaveBeenCalledTimes(1);

      expect(mockPort.dispatchWorkItem).not.toHaveBeenCalled();
      expect(mockPort.submitReviewDecision).not.toHaveBeenCalled();
      expect(mockPort.requestMerge).not.toHaveBeenCalled();
    });

    it("does not call updateStatus when existing item already has the same status", async () => {
      const existingItem = makeWorkItemRecord({
        id: "wi-existing",
        status: "todo",
        metadata: {
          importedRepoReconciliation: true,
          sourceId:
            "imported-repo:project-1:existing_capability:workflow-runtime",
          sourceHash: "old-hash",
          workType: "existing_capability",
          evidence: {},
          reason: "",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existingItem]);

      const spec = makeSpec({
        status: "todo",
        metadata: { sourceHash: "new-hash" },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(mockPort.updateStatus).not.toHaveBeenCalled();
      expect(mockPort.updateWorkItem).toHaveBeenCalledTimes(1);
    });

    it("counts as error when updateStatus rejects an unsupported status", async () => {
      const existingItem = makeWorkItemRecord({
        id: "wi-existing",
        status: "done",
        metadata: {
          importedRepoReconciliation: true,
          sourceId:
            "imported-repo:project-1:existing_capability:workflow-runtime",
          sourceHash: "old-hash",
          workType: "existing_capability",
          evidence: {},
          reason: "",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existingItem]);
      mockPort.updateStatus.mockRejectedValueOnce(
        new BadRequestException("Invalid work item status: archived"),
      );

      const spec = makeSpec({
        status: "archived" as RepositoryWorkItemSpec["status"],
        metadata: { sourceHash: "new-hash" },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.errors).toBe(1);
      expect(result.outcomes[0].action).toBe("error");
      expect(result.outcomes[0].error).toContain("Invalid work item status");
    });
  });
});
