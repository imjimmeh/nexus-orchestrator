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
  describe("autonomous rerun reclassification of imported human-decision items", () => {
    it("preserves manual todo override when userStatusOverride is set but lastGeneratedStatus is missing", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-hd-override-no-lgs",
        status: "todo",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:data-migration",
          sourceHash: "hash-v1",
          workType: "human_decision",
          importedRepoReconciliation: true,
          userStatusOverride: true,
          overridePreservedAt: "2026-05-09T10:00:00.000Z",
          currentDisposition: "todo",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existing]);

      const spec = makeSpec({
        sourceId: "imported-repo:project-1:human_decision:data-migration",
        status: "blocked",
        workType: "human_decision",
        title: "data-migration",
        reason: "Supervised rerun recommends blocked.",
        metadata: {
          sourceHash: "hash-v2",
          feedbackNeeded: true,
          lastGeneratedStatus: "blocked",
          generatedRecommendation: "blocked",
        },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(mockPort.updateStatus).not.toHaveBeenCalled();

      const [, , data] = mockPort.updateWorkItem.mock.calls[0];
      const metadata = data.metadata as Record<string, unknown>;
      expect(metadata.userStatusOverride).toBe(true);
      expect(metadata.currentDisposition).toBe("todo");
      expect(metadata.generatedRecommendation).toBe("blocked");
    });

    it("preserves manual backlog override when userStatusOverride is set and spec recommends todo", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-hd-backlog-override",
        status: "backlog",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:data-migration",
          sourceHash: "hash-v1",
          workType: "human_decision",
          importedRepoReconciliation: true,
          userStatusOverride: true,
          overridePreservedAt: "2026-05-09T10:00:00.000Z",
          currentDisposition: "backlog",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existing]);

      const spec = makeSpec({
        sourceId: "imported-repo:project-1:human_decision:data-migration",
        status: "todo",
        workType: "gap",
        title: "data-migration",
        reason: "Autonomous resolution.",
        metadata: {
          sourceHash: "hash-v2",
          originalWorkType: "human_decision",
          autonomousDecision: true,
          lastGeneratedStatus: "todo",
          generatedRecommendation: "todo",
        },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(mockPort.updateStatus).not.toHaveBeenCalled();

      const [, , data] = mockPort.updateWorkItem.mock.calls[0];
      const metadata = data.metadata as Record<string, unknown>;
      expect(metadata.userStatusOverride).toBe(true);
      expect(metadata.currentDisposition).toBe("backlog");
      expect(metadata.generatedRecommendation).toBe("todo");
    });

    it("finds existing :human_decision: item by compatibility lookup when spec sourceId uses :gap:", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-hd-compat",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:data-migration",
          sourceHash: "hash-v1",
          workType: "human_decision",
          importedRepoReconciliation: true,
          lastGeneratedStatus: "blocked",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existing]);

      const spec = makeSpec({
        sourceId: "imported-repo:project-1:gap:data-migration",
        status: "todo",
        workType: "gap",
        title: "data-migration",
        reason: "Autonomous resolution.",
        metadata: {
          sourceHash: "hash-v2",
          originalWorkType: "human_decision",
          autonomousDecision: true,
          lastGeneratedStatus: "todo",
          generatedRecommendation: "todo",
        },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(result.counts.created).toBe(0);
      expect(mockPort.createWorkItem).not.toHaveBeenCalled();
      const [, , updateData] = mockPort.updateWorkItem.mock.calls[0];
      const updateMetadata = updateData.metadata as Record<string, unknown>;
      expect(updateMetadata.importedRepoReconciliation).toBe(true);
      expect(updateMetadata.sourceHash).toBe("hash-v2");
    });

    it("finds existing :gap: item by compatibility lookup when spec sourceId uses :human_decision:", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-gap-compat",
        status: "todo",
        metadata: {
          sourceId: "imported-repo:project-1:gap:data-migration",
          sourceHash: "hash-v1",
          workType: "gap",
          importedRepoReconciliation: true,
          lastGeneratedStatus: "todo",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existing]);

      const spec = makeSpec({
        sourceId: "imported-repo:project-1:human_decision:data-migration",
        status: "blocked",
        workType: "human_decision",
        title: "data-migration",
        reason: "Supervised block.",
        metadata: {
          sourceHash: "hash-v2",
          feedbackNeeded: true,
          lastGeneratedStatus: "blocked",
          generatedRecommendation: "blocked",
        },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(result.counts.created).toBe(0);
      expect(mockPort.createWorkItem).not.toHaveBeenCalled();
    });
  });
});
