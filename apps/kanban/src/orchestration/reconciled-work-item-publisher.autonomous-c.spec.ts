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
    it("updates metadata when hash and status match but generated metadata differs (reclassification backfill)", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-reclass-backfill",
        status: "todo",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:data-migration",
          sourceHash: "shared-hash",
          workType: "human_decision",
          importedRepoReconciliation: true,
          lastGeneratedStatus: "blocked",
          lastGeneratedWorkType: "human_decision",
          generatedRecommendation: "blocked",
          feedbackNeeded: true,
          autonomousDecision: false,
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
          sourceHash: "shared-hash",
          originalWorkType: "human_decision",
          autonomousDecision: true,
          feedbackNeeded: false,
          lastGeneratedStatus: "todo",
          generatedRecommendation: "todo",
        },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(result.counts.unchanged).toBe(0);
      expect(mockPort.updateWorkItem).toHaveBeenCalledTimes(1);

      const [, , data] = mockPort.updateWorkItem.mock.calls[0];
      const metadata = data.metadata as Record<string, unknown>;
      expect(metadata.workType).toBe("gap");
      expect(metadata.lastGeneratedWorkType).toBe("gap");
      expect(metadata.autonomousDecision).toBe(true);
      expect(metadata.lastGeneratedStatus).toBe("todo");
      expect(metadata.generatedRecommendation).toBe("todo");
    });

    it("alias match preserves existing :human_decision: sourceId in metadata", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-alias-sourceid",
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

      const [, , data] = mockPort.updateWorkItem.mock.calls[0];
      const metadata = data.metadata as Record<string, unknown>;
      expect(metadata.sourceId).toBe(
        "imported-repo:project-1:human_decision:data-migration",
      );
    });

    it("direct match uses spec sourceId in metadata", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-direct-sourceid",
        status: "todo",
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

      const [, , data] = mockPort.updateWorkItem.mock.calls[0];
      const metadata = data.metadata as Record<string, unknown>;
      expect(metadata.sourceId).toBe(
        "imported-repo:project-1:human_decision:data-migration",
      );
    });

    it("remains unchanged when hash, status, and generated metadata all match", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-fully-matched",
        status: "todo",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:data-migration",
          sourceHash: "shared-hash",
          workType: "gap",
          importedRepoReconciliation: true,
          lastGeneratedStatus: "todo",
          lastGeneratedWorkType: "gap",
          generatedRecommendation: "todo",
          autonomousDecision: true,
          feedbackNeeded: false,
          policy: "decide_without_approval",
          resolutionRationale: "Autonomous mode decided without approval.",
          originalWorkType: "human_decision",
          evidence: { artifactPath: "probes/data-migration.md" },
          reason: "Autonomous resolution.",
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
          sourceHash: "shared-hash",
          originalWorkType: "human_decision",
          autonomousDecision: true,
          feedbackNeeded: false,
          policy: "decide_without_approval",
          resolutionRationale: "Autonomous mode decided without approval.",
          lastGeneratedStatus: "todo",
          generatedRecommendation: "todo",
        },
        evidence: {
          artifactPath: "probes/data-migration.md",
          evidenceRefs: [],
          sourcePaths: [],
        },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.unchanged).toBe(1);
      expect(result.counts.updated).toBe(0);
      expect(mockPort.updateWorkItem).not.toHaveBeenCalled();
    });
  });
});
