import { beforeEach, describe, expect, it } from "vitest";
import { ReconciledWorkItemPublisher } from "./reconciled-work-item-publisher";
import {
  makePlan,
  makeSpec,
  makeWorkItemRecord,
  setupPublisherTest,
} from "./reconciled-work-item-publisher.spec-helpers";

describe("ReconciledWorkItemPublisher", () => {
  let publisher: ReconciledWorkItemPublisher;
  let mockPort: ReturnType<typeof setupPublisherTest>["mockPort"];

  beforeEach(() => {
    ({ publisher, mockPort } = setupPublisherTest());
  });
  describe("mixed plan with create, update, and unchanged", () => {
    it("handles a plan with new, changed, and unchanged specs in one call", async () => {
      const existingUpdated = makeWorkItemRecord({
        id: "wi-updated",
        metadata: {
          importedRepoReconciliation: true,
          sourceId: "imported-repo:project-1:gap:api-auth",
          sourceHash: "old-hash-for-auth",
          workType: "gap",
          evidence: {},
          reason: "",
        },
      });
      const existingUnchanged = makeWorkItemRecord({
        id: "wi-unchanged",
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
      mockPort.listWorkItems.mockResolvedValue([
        existingUpdated,
        existingUnchanged,
      ]);

      const newSpec = makeSpec({
        sourceId: "imported-repo:project-1:human_decision:data-migration",
        status: "blocked",
        workType: "human_decision",
        title: "data-migration",
        reason: "Open questions about migration strategy.",
        metadata: { sourceHash: "hash-migration" },
      });
      const changedSpec = makeSpec({
        sourceId: "imported-repo:project-1:gap:api-auth",
        status: "todo",
        workType: "gap",
        title: "api-auth",
        reason: "Missing refresh-token rotation.",
        metadata: { sourceHash: "new-hash-for-auth" },
      });
      const unchangedSpec = makeSpec();
      const plan = makePlan([newSpec, changedSpec, unchangedSpec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.created).toBe(1);
      expect(result.counts.updated).toBe(1);
      expect(result.counts.unchanged).toBe(1);

      expect(mockPort.createWorkItem).toHaveBeenCalledTimes(1);
      expect(mockPort.updateWorkItem).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    it("counts an error and continues processing remaining specs", async () => {
      mockPort.listWorkItems.mockResolvedValue([]);
      mockPort.createWorkItem
        .mockRejectedValueOnce(new Error("DB connection lost"))
        .mockResolvedValueOnce(makeWorkItemRecord({ id: "wi-ok" }));

      const spec1 = makeSpec({ sourceId: "spec-1" });
      const spec2 = makeSpec({ sourceId: "spec-2" });
      const plan = makePlan([spec1, spec2]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.errors).toBe(1);
      expect(result.counts.created).toBe(1);
      expect(result.outcomes).toHaveLength(2);
      expect(result.outcomes[0].action).toBe("error");
      expect(result.outcomes[0].error).toBe("DB connection lost");
      expect(result.outcomes[1].action).toBe("created");
    });
  });

  describe("empty plan", () => {
    it("returns zero counts and empty outcomes for an empty plan", async () => {
      const plan = makePlan([]);
      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.created).toBe(0);
      expect(result.counts.updated).toBe(0);
      expect(result.counts.unchanged).toBe(0);
      expect(result.counts.errors).toBe(0);
      expect(result.outcomes).toHaveLength(0);
    });
  });

  describe("matching sourceId with same sourceHash but different status reconciles status", () => {
    it("calls updateStatus when hash matches but status drifted", async () => {
      const existingItem = makeWorkItemRecord({
        id: "wi-existing",
        status: "in-progress",
        metadata: {
          importedRepoReconciliation: true,
          sourceId:
            "imported-repo:project-1:existing_capability:workflow-runtime",
          sourceHash: "abc123def456",
          workType: "existing_capability",
          lastGeneratedStatus: "in-progress",
          lastGeneratedWorkType: "existing_capability",
          generatedRecommendation: "in-progress",
          evidence: {},
          reason: "",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existingItem]);

      const spec = makeSpec({ status: "blocked" });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(result.counts.unchanged).toBe(0);
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

    it("is unchanged only when both hash and status match", async () => {
      const existingItem = makeWorkItemRecord({
        id: "wi-existing",
        status: "todo",
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

      const spec = makeSpec({ status: "todo" });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.unchanged).toBe(1);
      expect(mockPort.updateStatus).not.toHaveBeenCalled();
      expect(mockPort.updateWorkItem).not.toHaveBeenCalled();
    });
  });

  describe("status transition ordering — status before metadata", () => {
    it("does not update metadata when status persistence fails", async () => {
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
        new Error("Status persistence failed"),
      );

      const spec = makeSpec({
        status: "todo",
        metadata: { sourceHash: "new-hash" },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.errors).toBe(1);
      expect(result.outcomes[0].action).toBe("error");
      expect(mockPort.updateStatus).toHaveBeenCalledTimes(1);
      expect(mockPort.updateWorkItem).not.toHaveBeenCalled();
    });
  });

  describe("duplicate sourceIds within a single batch", () => {
    it("does not create duplicate work items for identical specs with same sourceId", async () => {
      mockPort.listWorkItems.mockResolvedValue([]);
      const spec = makeSpec();
      const plan = makePlan([spec, spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.created).toBe(1);
      expect(result.counts.unchanged).toBe(1);
      expect(result.outcomes).toHaveLength(2);
      expect(result.outcomes[0].action).toBe("created");
      expect(result.outcomes[1].action).toBe("unchanged");
      expect(mockPort.createWorkItem).toHaveBeenCalledTimes(1);
    });

    it("preserves persisted status in index when duplicate sourceId specs have a preserved override", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-dup-override",
        status: "todo" as const,
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:ai-config",
          workType: "human_decision",
          lastGeneratedStatus: "blocked",
          lastGeneratedWorkType: "human_decision",
          importedRepoReconciliation: true,
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existing]);

      const spec1 = makeSpec({
        sourceId: "imported-repo:project-1:human_decision:ai-config",
        status: "blocked",
        workType: "human_decision",
        title: "ai-config",
        reason: "First pass",
        metadata: { sourceHash: "hash-v1", importedRepoReconciliation: true },
      });
      const spec2 = makeSpec({
        sourceId: "imported-repo:project-1:human_decision:ai-config",
        status: "blocked",
        workType: "human_decision",
        title: "ai-config",
        reason: "Second pass",
        metadata: { sourceHash: "hash-v2", importedRepoReconciliation: true },
      });
      const plan = makePlan([spec1, spec2]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(2);
      expect(mockPort.updateWorkItem).toHaveBeenCalledTimes(2);

      const [, , patch] = mockPort.updateWorkItem.mock.calls[1];
      const metadata = patch.metadata as Record<string, unknown>;
      expect(metadata.currentDisposition).toBe("todo");
    });

    it("updates instead of creating when duplicate sourceId has a changed hash", async () => {
      mockPort.listWorkItems.mockResolvedValue([]);
      const specV1 = makeSpec({ metadata: { sourceHash: "hash-v1" } });
      const specV2 = makeSpec({ metadata: { sourceHash: "hash-v2" } });
      const plan = makePlan([specV1, specV2]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.created).toBe(1);
      expect(result.counts.updated).toBe(1);
      expect(result.outcomes[0].action).toBe("created");
      expect(result.outcomes[1].action).toBe("updated");
      expect(mockPort.createWorkItem).toHaveBeenCalledTimes(1);
      expect(mockPort.updateWorkItem).toHaveBeenCalledTimes(1);
    });
  });

  describe("existing items with matching sourceId are reconciled regardless of marker", () => {
    it("updates an existing item that has a matching sourceId but no importedRepoReconciliation marker", async () => {
      const legacyItem = makeWorkItemRecord({
        id: "wi-legacy",
        status: "todo",
        metadata: {
          sourceId:
            "imported-repo:project-1:existing_capability:workflow-runtime",
          source: "legacy-import-tool",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([legacyItem]);

      const spec = makeSpec({ metadata: { sourceHash: "new-hash" } });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(result.counts.created).toBe(0);
      expect(mockPort.updateWorkItem).toHaveBeenCalledTimes(1);
      expect(mockPort.createWorkItem).not.toHaveBeenCalled();

      const [, , data] = mockPort.updateWorkItem.mock.calls[0];
      const patch = data;
      const metadata = patch.metadata as Record<string, unknown>;
      expect(metadata.importedRepoReconciliation).toBe(true);
      expect(metadata.sourceHash).toBe("new-hash");
    });

    it("does not match existing items without a string sourceId in metadata", async () => {
      const itemWithoutSourceId = makeWorkItemRecord({
        id: "wi-manual",
        metadata: { source: "manual" },
      });
      mockPort.listWorkItems.mockResolvedValue([itemWithoutSourceId]);

      const spec = makeSpec();
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.created).toBe(1);
      expect(mockPort.createWorkItem).toHaveBeenCalledTimes(1);
    });
  });
});
