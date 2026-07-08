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
  describe("imported-repo status override preservation", () => {
    it("does not update when override is already in place and sourceHash matches", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-override-idem",
        status: "todo" as const,
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:ai-config",
          workType: "human_decision",
          lastGeneratedStatus: "blocked",
          lastGeneratedWorkType: "human_decision",
          importedRepoReconciliation: true,
          userStatusOverride: true,
          overridePreservedAt: "2026-05-09T12:00:00.000Z",
          generatedRecommendation: "blocked",
          currentDisposition: "todo",
          sourceHash: "abc123",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existing]);

      const spec = makeSpec({
        sourceId: "imported-repo:project-1:human_decision:ai-config",
        status: "blocked",
        workType: "human_decision",
        title: "ai-config",
        reason: "Generated question",
        metadata: { sourceHash: "abc123", importedRepoReconciliation: true },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.unchanged).toBe(1);
      expect(result.counts.updated).toBe(0);
      expect(mockPort.updateWorkItem).not.toHaveBeenCalled();
      expect(mockPort.updateStatus).not.toHaveBeenCalled();
    });

    it("preserves a manual status override when reconciliation still recommends the generated status", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-override",
        status: "todo" as const,
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:ai-config",
          workType: "human_decision",
          importedRepoReconciliation: true,
          lastGeneratedStatus: "blocked",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existing]);

      const spec = makeSpec({
        sourceId: "imported-repo:project-1:human_decision:ai-config",
        status: "blocked",
        workType: "human_decision",
        title: "ai-config",
        reason: "Generated question",
        metadata: { sourceHash: "abc123", importedRepoReconciliation: true },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      const [, , updateData] = mockPort.updateWorkItem.mock.calls[0];
      const updateMetadata = updateData.metadata as Record<string, unknown>;
      expect(updateMetadata.userStatusOverride).toBe(true);
      expect(updateMetadata.lastGeneratedStatus).toBe("blocked");
      expect(updateMetadata.generatedRecommendation).toBe("blocked");
      expect(updateMetadata.currentDisposition).toBe("todo");
    });

    it("updates generated status when the existing item still matches the last generated status", async () => {
      const existing = makeWorkItemRecord({
        id: "wi-genstatus",
        status: "blocked" as const,
        metadata: {
          sourceId: "imported-repo:project-1:human_decision:ai-config",
          lastGeneratedStatus: "blocked",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existing]);

      const spec = makeSpec({
        sourceId: "imported-repo:project-1:human_decision:ai-config",
        status: "todo",
        workType: "gap",
        title: "ai-config",
        reason: "Now actionable",
        metadata: { sourceHash: "abc123", importedRepoReconciliation: true },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      const [, , updateData] = mockPort.updateWorkItem.mock.calls[0];
      const updateMetadata = updateData.metadata as Record<string, unknown>;
      expect(updateMetadata.lastGeneratedStatus).toBe("todo");
      expect(updateMetadata.lastGeneratedWorkType).toBe("gap");
      expect(updateMetadata.generatedRecommendation).toBe("todo");
    });
  });

  describe("metadata preservation during update", () => {
    it("preserves unrelated existing metadata while overwriting reconciliation fields", async () => {
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
          reason: "old reason",
          assignee: "bob",
          originalTool: "legacy-importer",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existingItem]);

      const spec = makeSpec({ metadata: { sourceHash: "new-hash" } });
      const plan = makePlan([spec]);

      await publisher.publish(plan, "project-1");

      expect(mockPort.updateWorkItem).toHaveBeenCalledTimes(1);
      const [, , data] = mockPort.updateWorkItem.mock.calls[0];
      const patch = data;
      const metadata = patch.metadata as Record<string, unknown>;

      expect(metadata.sourceHash).toBe("new-hash");
      expect(metadata.importedRepoReconciliation).toBe(true);
      expect(metadata.assignee).toBe("bob");
      expect(metadata.originalTool).toBe("legacy-importer");
    });
  });

  describe("human decision policy metadata preservation", () => {
    it("persists human decision policy fields on work item creation", async () => {
      mockPort.listWorkItems.mockResolvedValue([]);
      const spec = makeSpec({
        sourceId: "imported-repo:project-1:human_decision:data-migration",
        status: "blocked",
        workType: "human_decision",
        title: "data-migration",
        reason: "Open questions about migration strategy.",
        metadata: {
          sourceHash: "hash-migration",
          importedRepoReconciliation: true,
          originalWorkType: "gap",
          autonomousDecision: false,
          feedbackNeeded: true,
          decisionPrompt: "Which migration strategy minimizes downtime?",
          resolutionRationale: "Awaiting DBA review",
          policy: "ask_when_uncertain",
          lastGeneratedStatus: "blocked",
          generatedRecommendation: "blocked",
        },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.created).toBe(1);
      const [, input] = mockPort.createWorkItem.mock.calls[0];
      const metadata = input.metadata as Record<string, unknown>;

      expect(metadata.originalWorkType).toBe("gap");
      expect(metadata.autonomousDecision).toBe(false);
      expect(metadata.feedbackNeeded).toBe(true);
      expect(metadata.decisionPrompt).toBe(
        "Which migration strategy minimizes downtime?",
      );
      expect(metadata.resolutionRationale).toBe("Awaiting DBA review");
      expect(metadata.policy).toBe("ask_when_uncertain");
      expect(metadata.lastGeneratedStatus).toBe("blocked");
      expect(metadata.generatedRecommendation).toBe("blocked");
    });

    it("persists human decision policy fields on work item update", async () => {
      const existingItem = makeWorkItemRecord({
        id: "wi-existing",
        status: "todo",
        metadata: {
          importedRepoReconciliation: true,
          sourceId: "imported-repo:project-1:human_decision:data-migration",
          sourceHash: "old-hash",
          workType: "human_decision",
          originalWorkType: "gap",
          autonomousDecision: false,
          feedbackNeeded: true,
          policy: "ask_when_uncertain",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existingItem]);

      const spec = makeSpec({
        sourceId: "imported-repo:project-1:human_decision:data-migration",
        status: "blocked",
        workType: "human_decision",
        title: "data-migration",
        reason: "Updated: still awaiting DBA review.",
        metadata: {
          sourceHash: "new-hash",
          importedRepoReconciliation: true,
          originalWorkType: "gap",
          autonomousDecision: false,
          feedbackNeeded: true,
          decisionPrompt: "Which migration strategy minimizes downtime?",
          resolutionRationale: "Awaiting DBA review",
          policy: "ask_when_uncertain",
          lastGeneratedStatus: "blocked",
          generatedRecommendation: "blocked",
        },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      const [, , data] = mockPort.updateWorkItem.mock.calls[0];
      const patch = data;
      const metadata = patch.metadata as Record<string, unknown>;

      expect(metadata.sourceHash).toBe("new-hash");
      expect(metadata.originalWorkType).toBe("gap");
      expect(metadata.autonomousDecision).toBe(false);
      expect(metadata.feedbackNeeded).toBe(true);
      expect(metadata.decisionPrompt).toBe(
        "Which migration strategy minimizes downtime?",
      );
      expect(metadata.resolutionRationale).toBe("Awaiting DBA review");
      expect(metadata.policy).toBe("ask_when_uncertain");
      expect(metadata.lastGeneratedStatus).toBe("blocked");
      expect(metadata.generatedRecommendation).toBe("blocked");
    });

    it("preserves human decision fields during update when userStatusOverride is in place", async () => {
      const existingItem = makeWorkItemRecord({
        id: "wi-override",
        status: "todo",
        metadata: {
          importedRepoReconciliation: true,
          sourceId: "imported-repo:project-1:human_decision:data-migration",
          sourceHash: "old-hash",
          workType: "human_decision",
          originalWorkType: "gap",
          autonomousDecision: false,
          feedbackNeeded: true,
          userStatusOverride: true,
          overridePreservedAt: "2026-05-09T12:00:00.000Z",
          currentDisposition: "todo",
          generatedRecommendation: "blocked",
        },
      });
      mockPort.listWorkItems.mockResolvedValue([existingItem]);

      const spec = makeSpec({
        sourceId: "imported-repo:project-1:human_decision:data-migration",
        status: "blocked",
        workType: "human_decision",
        title: "data-migration",
        reason: "Generated recommendation",
        metadata: {
          sourceHash: "new-hash",
          importedRepoReconciliation: true,
          originalWorkType: "gap",
          autonomousDecision: false,
          feedbackNeeded: true,
          decisionPrompt: "Which migration strategy minimizes downtime?",
          resolutionRationale: "Awaiting DBA review",
          policy: "ask_when_uncertain",
          lastGeneratedStatus: "blocked",
          generatedRecommendation: "blocked",
        },
      });
      const plan = makePlan([spec]);

      const result = await publisher.publish(plan, "project-1");

      expect(result.counts.updated).toBe(1);
      const [, , data] = mockPort.updateWorkItem.mock.calls[0];
      const patch = data;
      const metadata = patch.metadata as Record<string, unknown>;

      expect(metadata.userStatusOverride).toBe(true);
      expect(metadata.currentDisposition).toBe("todo");
      expect(metadata.originalWorkType).toBe("gap");
      expect(metadata.autonomousDecision).toBe(false);
      expect(metadata.feedbackNeeded).toBe(true);
      expect(metadata.decisionPrompt).toBe(
        "Which migration strategy minimizes downtime?",
      );
      expect(metadata.resolutionRationale).toBe("Awaiting DBA review");
      expect(metadata.policy).toBe("ask_when_uncertain");
      expect(metadata.lastGeneratedStatus).toBe("blocked");
      expect(metadata.generatedRecommendation).toBe("blocked");
    });
  });
});
