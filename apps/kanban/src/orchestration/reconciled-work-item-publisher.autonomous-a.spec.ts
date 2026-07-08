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
    it("updates existing blocked human_decision item to autonomous gap/todo disposition", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-hd-rerun",
        status: "blocked",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:data-migration",
          sourceHash: "hash-v1",
          workType: "human_decision",
          importedRepoReconciliation: true,
          originalWorkType: "human_decision",
          feedbackNeeded: true,
          lastGeneratedStatus: "blocked",
          generatedRecommendation: "blocked",
          evidence: { artifactPath: "probes/data-migration.md" },
          reason: "Open questions about migration strategy.",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existing]);

      const spec = makeSpec({
        sourceId: "imported-repo:project-1:human_decision:data-migration",
        status: "todo",
        workType: "gap",
        title: "data-migration",
        reason: "Autonomous resolution of migration questions.",
        metadata: {
          sourceHash: "hash-v2",
          originalWorkType: "human_decision",
          autonomousDecision: true,
          feedbackNeeded: false,
          resolutionRationale:
            "Autonomous mode decided without approval. This finding has been converted into actionable work.",
          policy: "decide_without_approval",
          lastGeneratedStatus: "todo",
          generatedRecommendation: "todo",
        },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(result.counts.created).toBe(0);
      expect(mockPort.updateStatus).toHaveBeenCalledWith(
        "project-1",
        "wi-hd-rerun",
        "todo",
      );

      const [, , data] = mockPort.updateWorkItem.mock.calls[0];
      const metadata = data.metadata as Record<string, unknown>;
      expect(metadata.workType).toBe("gap");
      expect(metadata.originalWorkType).toBe("human_decision");
      expect(metadata.autonomousDecision).toBe(true);
      expect(metadata.importedRepoReconciliation).toBe(true);
      expect(metadata.lastGeneratedStatus).toBe("todo");
      expect(metadata.lastGeneratedWorkType).toBe("gap");
      expect(metadata.generatedRecommendation).toBe("todo");
    });

    it("preserves manual todo status override while updating autonomous recommendation metadata", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-hd-override-autonomous",
        status: "todo",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:data-migration",
          sourceHash: "hash-v1",
          workType: "human_decision",
          importedRepoReconciliation: true,
          originalWorkType: "human_decision",
          lastGeneratedStatus: "blocked",
          userStatusOverride: true,
          overridePreservedAt: "2026-05-09T10:00:00.000Z",
          currentDisposition: "todo",
          generatedRecommendation: "blocked",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existing]);

      const spec = makeSpec({
        sourceId: "imported-repo:project-1:human_decision:data-migration",
        status: "todo",
        workType: "gap",
        title: "data-migration",
        reason: "Autonomous resolution of migration questions.",
        metadata: {
          sourceHash: "hash-v2",
          originalWorkType: "human_decision",
          autonomousDecision: true,
          feedbackNeeded: false,
          resolutionRationale: "Autonomous decision based on analysis.",
          policy: "decide_without_approval",
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
      expect(metadata.currentDisposition).toBe("todo");
      expect(metadata.generatedRecommendation).toBe("todo");
      expect(metadata.lastGeneratedStatus).toBe("todo");
      expect(metadata.lastGeneratedWorkType).toBe("gap");
      expect(metadata.originalWorkType).toBe("human_decision");
      expect(metadata.autonomousDecision).toBe(true);
      expect(metadata.importedRepoReconciliation).toBe(true);
    });
  });
});
