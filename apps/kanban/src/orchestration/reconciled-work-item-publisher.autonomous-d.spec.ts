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
    it("updates metadata when hash/status/workType match but policy metadata is missing", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-policy-backfill",
        status: "todo",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:data-migration",
          sourceHash: "shared-hash",
          workType: "gap",
          importedRepoReconciliation: true,
          lastGeneratedStatus: "todo",
          lastGeneratedWorkType: "gap",
          generatedRecommendation: "todo",
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
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(result.counts.unchanged).toBe(0);
      expect(mockPort.updateStatus).not.toHaveBeenCalled();
      expect(mockPort.updateWorkItem).toHaveBeenCalledTimes(1);

      const [, , data] = mockPort.updateWorkItem.mock.calls[0];
      const metadata = data.metadata as Record<string, unknown>;
      expect(metadata.autonomousDecision).toBe(true);
      expect(metadata.originalWorkType).toBe("human_decision");
      expect(metadata.policy).toBe("decide_without_approval");
      expect(metadata.feedbackNeeded).toBe(false);
      expect(metadata.resolutionRationale).toContain("Autonomous");
    });

    it("updates metadata when hash/status/workType match but supervised policy metadata is stale", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-policy-stale",
        status: "todo",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:data-migration",
          sourceHash: "shared-hash",
          workType: "gap",
          importedRepoReconciliation: true,
          lastGeneratedStatus: "todo",
          lastGeneratedWorkType: "gap",
          generatedRecommendation: "todo",
          autonomousDecision: false,
          feedbackNeeded: true,
          policy: "ask_when_uncertain",
          decisionPrompt: "Review required: migration question",
          resolutionRationale: "Supervised mode requires human feedback.",
          originalWorkType: "human_decision",
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
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(result.counts.unchanged).toBe(0);
      expect(mockPort.updateStatus).not.toHaveBeenCalled();

      const [, , data] = mockPort.updateWorkItem.mock.calls[0];
      const metadata = data.metadata as Record<string, unknown>;
      expect(metadata.autonomousDecision).toBe(true);
      expect(metadata.policy).toBe("decide_without_approval");
      expect(metadata.feedbackNeeded).toBe(false);
      expect(metadata.decisionPrompt).toBeNull();
    });

    it("clears stale supervised decision prompt when autonomous metadata otherwise matches", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-stale-prompt",
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
          decisionPrompt: "Review required: migration question",
          resolutionRationale: "Autonomous mode decided without approval.",
          originalWorkType: "human_decision",
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
        },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(result.counts.unchanged).toBe(0);
      expect(mockPort.updateStatus).not.toHaveBeenCalled();

      const [, , data] = mockPort.updateWorkItem.mock.calls[0];
      const metadata = data.metadata as Record<string, unknown>;
      expect(metadata.decisionPrompt).toBeNull();
    });

    it("remains unchanged when all fields including policy metadata match", async () => {
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

    it("backfills stale workType/recommendation when spec metadata omits generated fields", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-stale-worktype",
        status: "todo",
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:data-migration",
          sourceHash: "shared-hash",
          workType: "human_decision",
          lastGeneratedStatus: "todo",
          lastGeneratedWorkType: "human_decision",
          generatedRecommendation: "blocked",
          importedRepoReconciliation: true,
          originalWorkType: "human_decision",
          autonomousDecision: true,
          feedbackNeeded: false,
          policy: "decide_without_approval",
          resolutionRationale: "Autonomous mode decided without approval.",
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
        },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      expect(result.counts.unchanged).toBe(0);
      expect(mockPort.updateStatus).not.toHaveBeenCalled();
      expect(mockPort.updateWorkItem).toHaveBeenCalledTimes(1);

      const [, , data] = mockPort.updateWorkItem.mock.calls[0];
      const metadata = data.metadata as Record<string, unknown>;
      expect(metadata.workType).toBe("gap");
      expect(metadata.lastGeneratedWorkType).toBe("gap");
      expect(metadata.generatedRecommendation).toBe("todo");
    });
  });
});
