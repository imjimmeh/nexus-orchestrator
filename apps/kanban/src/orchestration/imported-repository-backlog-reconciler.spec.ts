import { describe, expect, it } from "vitest";
import type { ProbeResultArtifact } from "./probe-result-artifact";
import {
  ImportedRepositoryBacklogReconciler,
  type ImportedRepositoryBacklogReconcilerInput,
  type ImportedRepositoryBacklogReconciliationPlan,
  type OrchestrationCycleDecision,
  type RepositoryWorkItemSpec,
} from "./imported-repository-backlog-reconciler";
import type { KanbanOrchestrationMode } from "./human-decision-resolution-policy.types";

function highConfidenceImplementedArtifact(
  overrides: Partial<ProbeResultArtifact> = {},
): ProbeResultArtifact {
  return {
    path: "probes/workflow-runtime.md",
    projectScopeId: "project-1",
    probeScopeId: "workflow-runtime",
    outcome: "success",
    inferredStatus: "implemented",
    confidenceScore: 0.95,
    evidenceRefs: [
      "apps/api/src/workflow/workflow-runtime/workflow-runtime.module.ts",
    ],
    sourcePaths: ["apps/api/src/workflow/workflow-runtime"],
    narrativeSummary: "Workflow runtime module is fully implemented.",
    ...overrides,
  };
}

function partialArtifactWithHealthFindings(
  overrides: Partial<ProbeResultArtifact> = {},
): ProbeResultArtifact {
  return {
    path: "probes/api-auth.md",
    projectScopeId: "project-1",
    probeScopeId: "api-auth",
    outcome: "partial",
    inferredStatus: "partial",
    confidenceScore: 0.6,
    evidenceRefs: ["apps/api/src/auth/auth.module.ts"],
    sourcePaths: ["apps/api/src/auth"],
    narrativeSummary: "Auth module partially covers token validation.",
    healthFindings:
      "Missing refresh-token rotation. Token expiry not validated on all paths.",
    ...overrides,
  };
}

function artifactWithOpenQuestions(
  overrides: Partial<ProbeResultArtifact> = {},
): ProbeResultArtifact {
  return {
    path: "probes/data-migration.md",
    projectScopeId: "project-1",
    probeScopeId: "data-migration",
    outcome: "partial",
    inferredStatus: "unknown",
    confidenceScore: 0.4,
    evidenceRefs: [],
    sourcePaths: [],
    narrativeSummary: "Data migration strategy is unclear.",
    openQuestions:
      "Should legacy data be migrated in-place or via ETL pipeline? What is the acceptable downtime window?",
    ...overrides,
  };
}

describe("ImportedRepositoryBacklogReconciler", () => {
  const reconciler = new ImportedRepositoryBacklogReconciler();

  describe("high-confidence implemented/success artifacts", () => {
    it("maps an implemented artifact with high confidence to a done existing_capability spec", () => {
      const artifact = highConfidenceImplementedArtifact();
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [artifact],
      };

      const plan = reconciler.reconcile(input);

      expect(plan.specs).toHaveLength(1);
      const spec = plan.specs[0];
      expect(spec.status).toBe("done");
      expect(spec.workType).toBe("existing_capability");
      expect(spec.title).toContain("workflow-runtime");
      expect(spec.reason).toBeTruthy();
      expect(spec.evidence.artifactPath).toBe("probes/workflow-runtime.md");
      expect(spec.evidence.probeScopeId).toBe("workflow-runtime");
      expect(spec.evidence.confidenceScore).toBe(0.95);
      expect(spec.evidence.evidenceRefs).toEqual([
        "apps/api/src/workflow/workflow-runtime/workflow-runtime.module.ts",
      ]);
      expect(spec.evidence.sourcePaths).toEqual([
        "apps/api/src/workflow/workflow-runtime",
      ]);
    });

    it("maps a success artifact with high confidence to done existing_capability", () => {
      const artifact = highConfidenceImplementedArtifact({
        inferredStatus: "success",
        outcome: "success",
      });
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [artifact],
      };

      const plan = reconciler.reconcile(input);

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("done");
      expect(plan.specs[0].workType).toBe("existing_capability");
    });
  });

  describe("partial artifacts with health findings", () => {
    it("maps a partial artifact with health findings to a todo gap spec", () => {
      const artifact = partialArtifactWithHealthFindings();
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [artifact],
      };

      const plan = reconciler.reconcile(input);

      expect(plan.specs).toHaveLength(1);
      const spec = plan.specs[0];
      expect(spec.status).toBe("todo");
      expect(spec.workType).toBe("gap");
      expect(spec.title).toContain("api-auth");
      expect(spec.reason).toContain("refresh-token");
      expect(spec.evidence.artifactPath).toBe("probes/api-auth.md");
      expect(spec.evidence.probeScopeId).toBe("api-auth");
      expect(spec.evidence.confidenceScore).toBe(0.6);
    });
  });

  describe("open questions", () => {
    it("maps open questions to blocked human_decision specs", () => {
      const artifact = artifactWithOpenQuestions();
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [artifact],
      };

      const plan = reconciler.reconcile(input);

      expect(plan.specs).toHaveLength(1);
      const spec = plan.specs[0];
      expect(spec.status).toBe("blocked");
      expect(spec.workType).toBe("human_decision");
      expect(spec.title).toContain("data-migration");
      expect(spec.reason).toContain("ETL");
      expect(spec.evidence.probeScopeId).toBe("data-migration");
    });

    it("classifies open questions as blocked even when confidence is high and status is implemented", () => {
      const artifact = highConfidenceImplementedArtifact({
        openQuestions: "Is this module still actively maintained?",
      });

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("blocked");
      expect(plan.specs[0].workType).toBe("human_decision");
    });

    it("classifies health findings as todo even when confidence is high and status is implemented", () => {
      const artifact = highConfidenceImplementedArtifact({
        healthFindings: "Memory leak in long-running sessions.",
      });

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("todo");
      expect(plan.specs[0].workType).toBe("gap");
    });

    it("classifies open questions as blocked over health findings when both are present", () => {
      const artifact = highConfidenceImplementedArtifact({
        healthFindings: "Some edge cases in error handling.",
        openQuestions: "Should we refactor the error boundary?",
      });

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("blocked");
      expect(plan.specs[0].workType).toBe("human_decision");
    });
  });

  describe("deterministic source IDs and hashes", () => {
    it("produces deterministic sourceId across identical runs", () => {
      const artifact = highConfidenceImplementedArtifact();
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [artifact],
      };

      const plan1 = reconciler.reconcile(input);
      const plan2 = reconciler.reconcile(input);

      expect(plan1.specs[0].sourceId).toBe(plan2.specs[0].sourceId);
      expect(plan1.specs[0].metadata.sourceHash).toBe(
        plan2.specs[0].metadata.sourceHash,
      );
    });

    it("uses the imported-repo:<projectId>:<workType>:<scope> sourceId format", () => {
      const artifact = highConfidenceImplementedArtifact();
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [artifact],
      };

      const plan = reconciler.reconcile(input);

      expect(plan.specs[0].sourceId).toMatch(
        /^imported-repo:project-1:existing_capability:/,
      );
    });

    it("produces different sourceHashes for different artifacts", () => {
      const artifact1 = highConfidenceImplementedArtifact();
      const artifact2 = highConfidenceImplementedArtifact({
        probeScopeId: "different-scope",
        narrativeSummary: "Different narrative.",
      });

      const plan1 = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact1],
      });
      const plan2 = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact2],
      });

      expect(plan1.specs[0].metadata.sourceHash).not.toBe(
        plan2.specs[0].metadata.sourceHash,
      );
    });

    it("produces different sourceHashes when only evidence refs change", () => {
      const artifact1 = highConfidenceImplementedArtifact();
      const artifact2 = highConfidenceImplementedArtifact({
        evidenceRefs: [
          "apps/api/src/workflow/workflow-runtime/workflow-runtime.module.ts",
          "apps/api/src/workflow/workflow-runtime/runtime.controller.ts",
        ],
      });

      const plan1 = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact1],
      });
      const plan2 = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact2],
      });

      expect(plan1.specs[0].metadata.sourceHash).not.toBe(
        plan2.specs[0].metadata.sourceHash,
      );
    });

    it("produces different sourceHashes when only source paths change", () => {
      const artifact1 = highConfidenceImplementedArtifact();
      const artifact2 = highConfidenceImplementedArtifact({
        sourcePaths: [
          "apps/api/src/workflow/workflow-runtime",
          "apps/api/src/workflow/shared",
        ],
      });

      const plan1 = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact1],
      });
      const plan2 = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact2],
      });

      expect(plan1.specs[0].metadata.sourceHash).not.toBe(
        plan2.specs[0].metadata.sourceHash,
      );
    });

    it("produces different sourceHashes when artifact path changes", () => {
      const artifact1 = highConfidenceImplementedArtifact();
      const artifact2 = highConfidenceImplementedArtifact({
        path: "probes/workflow-runtime-v2.md",
      });

      const plan1 = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact1],
      });
      const plan2 = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact2],
      });

      expect(plan1.specs[0].metadata.sourceHash).not.toBe(
        plan2.specs[0].metadata.sourceHash,
      );
    });
  });

  describe("reconciliation plan structure", () => {
    it("returns counts and summary in the plan", () => {
      const artifacts = [
        highConfidenceImplementedArtifact(),
        partialArtifactWithHealthFindings(),
        artifactWithOpenQuestions(),
      ];
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts,
      };

      const plan = reconciler.reconcile(input);

      expect(plan.counts.total).toBe(3);
      expect(plan.counts.done).toBe(1);
      expect(plan.counts.todo).toBe(1);
      expect(plan.counts.blocked).toBe(1);
      expect(plan.summary).toBeTruthy();
    });

    it("returns finding candidates alongside work item specs", () => {
      const artifacts = [
        highConfidenceImplementedArtifact(),
        partialArtifactWithHealthFindings(),
      ];
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts,
      };

      const plan = reconciler.reconcile(input);

      expect(plan.findings).toHaveLength(2);
      expect(plan.findings).toEqual(plan.specs);
      expect(plan.diagnostics.mappedFindings).toBe(2);
    });

    it("returns a cycleDecision with readyForCycle false when blocked specs exist", () => {
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [artifactWithOpenQuestions()],
      };

      const plan = reconciler.reconcile(input);

      expect(plan.cycleDecision.decision).toBe("blocked");
      expect(plan.cycleDecision.readyForCycle).toBe(false);
    });

    it("returns a cycleDecision with readyForCycle true when all specs are done", () => {
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [highConfidenceImplementedArtifact()],
      };

      const plan = reconciler.reconcile(input);

      expect(plan.cycleDecision.decision).toBe("complete");
      expect(plan.cycleDecision.readyForCycle).toBe(true);
    });

    it("returns a cycleDecision with repeat when todo specs exist", () => {
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [partialArtifactWithHealthFindings()],
      };

      const plan = reconciler.reconcile(input);

      expect(plan.cycleDecision.decision).toBe("repeat");
      expect(plan.cycleDecision.readyForCycle).toBe(true);
    });
  });

  describe("evidence metadata preservation", () => {
    it("preserves projectScopeId, outcome, inferredStatus, and narrativeSummary in evidence metadata", () => {
      const artifact = highConfidenceImplementedArtifact();
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [artifact],
      };

      const plan = reconciler.reconcile(input);
      const spec = plan.specs[0];

      expect(spec.evidence.projectScopeId).toBe("project-1");
      expect(spec.evidence.outcome).toBe("success");
      expect(spec.evidence.inferredStatus).toBe("implemented");
      expect(spec.evidence.narrativeSummary).toBe(
        "Workflow runtime module is fully implemented.",
      );
    });

    it("preserves capabilityUpdates and healthFindings in evidence metadata", () => {
      const artifact: ProbeResultArtifact = {
        path: "probes/workflow-runtime.md",
        projectScopeId: "project-1",
        probeScopeId: "workflow-runtime",
        outcome: "partial",
        inferredStatus: "implemented",
        confidenceScore: 0.85,
        evidenceRefs: ["apps/api/src/workflow/workflow-runtime.module.ts"],
        sourcePaths: ["apps/api/src/workflow"],
        narrativeSummary: "Mostly implemented.",
        capabilityUpdates: "Added retry policy to step executor.",
        healthFindings: "Edge case in retry timeout.",
      };

      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [artifact],
      };

      const plan = reconciler.reconcile(input);
      const spec = plan.specs[0];

      expect(spec.evidence.capabilityUpdates).toBe(
        "Added retry policy to step executor.",
      );
      expect(spec.evidence.healthFindings).toBe("Edge case in retry timeout.");
      expect(spec.status).toBe("todo");
      expect(spec.workType).toBe("gap");
    });

    it("preserves openQuestions in evidence metadata on blocked artifacts", () => {
      const artifact = artifactWithOpenQuestions();
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [artifact],
      };

      const plan = reconciler.reconcile(input);
      const spec = plan.specs[0];

      expect(spec.evidence.openQuestions).toContain("ETL");
      expect(spec.status).toBe("blocked");
    });

    it("preserves undefined optional fields as undefined in evidence metadata", () => {
      const artifact = highConfidenceImplementedArtifact();
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [artifact],
      };

      const plan = reconciler.reconcile(input);
      const spec = plan.specs[0];

      expect(spec.evidence.capabilityUpdates).toBeUndefined();
      expect(spec.evidence.healthFindings).toBeUndefined();
      expect(spec.evidence.openQuestions).toBeUndefined();
    });
  });

  describe("empty input", () => {
    it("returns an empty plan with no specs", () => {
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [],
      };

      const plan = reconciler.reconcile(input);

      expect(plan.specs).toHaveLength(0);
      expect(plan.counts.total).toBe(0);
      expect(plan.cycleDecision.decision).toBe("complete");
    });
  });

  describe("actionable probe findings", () => {
    it("classifies actionable probe findings with Bug/Evidence/Recommended fix markers as todo", () => {
      const artifact: ProbeResultArtifact = {
        path: "probes/agent-local.md",
        projectScopeId: "project-1",
        probeScopeId: "agent-local",
        outcome: "partial",
        inferredStatus: "partial",
        confidenceScore: 0.5,
        evidenceRefs: [],
        sourcePaths: [],
        healthFindings:
          "# Probe: agent-local\n\n## Findings\n- Bug: audit logging has a concurrency race in AgentLocalSessionWriter.\n- Evidence: apps/api/src/agent-local/session-writer.ts writes shared audit state without locking.\n- Recommended fix: add per-session serialization and regression tests.",
      };

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("todo");
      expect(plan.specs[0].workType).toBe("gap");
      expect(plan.specs[0].title).toContain("agent-local");
      expect(plan.specs[0].metadata).toMatchObject({
        sourceHash: expect.any(String),
      });
      expect(plan.specs[0].sourceId).toContain("imported-repo:");
    });

    it("classifies Test gap and Missing implementation markers as todo", () => {
      const artifact: ProbeResultArtifact = {
        path: "probes/test-coverage.md",
        projectScopeId: "project-1",
        probeScopeId: "test-coverage",
        outcome: "partial",
        inferredStatus: "partial",
        confidenceScore: 0.4,
        evidenceRefs: [],
        sourcePaths: [],
        healthFindings:
          "# Probe: test-coverage\n\n## Findings\n- Test gap: no unit tests for retry policy edge cases.\n- Missing implementation: fallback timeout not wired in step executor.",
      };

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("todo");
    });

    it("classifies Acceptance markers as todo", () => {
      const artifact: ProbeResultArtifact = {
        path: "probes/acceptance.md",
        projectScopeId: "project-1",
        probeScopeId: "acceptance",
        outcome: "partial",
        inferredStatus: "partial",
        confidenceScore: 0.3,
        evidenceRefs: [],
        sourcePaths: [],
        healthFindings:
          "# Probe: acceptance\n\n## Findings\n- Acceptance: integration test for deployment pipeline missing.",
      };

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("todo");
    });

    it("preserves human-decision blocked status for explicit review phrases", () => {
      const artifact: ProbeResultArtifact = {
        path: "probes/review-needed.md",
        projectScopeId: "project-1",
        probeScopeId: "review-needed",
        outcome: "partial",
        inferredStatus: "unknown",
        confidenceScore: 0.3,
        evidenceRefs: [],
        sourcePaths: [],
        healthFindings:
          "# Probe: review-needed\n\n## Findings\n- This requires product decision on data retention policy.\n- Pending human review for schema migration approach.",
      };

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("blocked");
      expect(plan.specs[0].workType).toBe("human_decision");
    });

    it("preserves human-decision blocked for needs owner input marker", () => {
      const artifact: ProbeResultArtifact = {
        path: "probes/owner-input.md",
        projectScopeId: "project-1",
        probeScopeId: "owner-input",
        outcome: "partial",
        inferredStatus: "unknown",
        confidenceScore: 0.3,
        evidenceRefs: [],
        sourcePaths: [],
        healthFindings:
          "Needs owner input before proceeding with architecture change.",
      };

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("blocked");
      expect(plan.specs[0].workType).toBe("human_decision");
    });

    it("preserves human-decision blocked for multi-word hyphenated phrase", () => {
      const artifact: ProbeResultArtifact = {
        path: "probes/hyphenated.md",
        projectScopeId: "project-1",
        probeScopeId: "hyphenated",
        outcome: "partial",
        inferredStatus: "unknown",
        confidenceScore: 0.3,
        evidenceRefs: [],
        sourcePaths: [],
        healthFindings:
          "This requires-product-decision on the data retention policy before proceeding.",
      };

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("blocked");
      expect(plan.specs[0].workType).toBe("human_decision");
    });

    it("keeps cycleDecision blocked when human-decision findings exist alongside actionable todo items", () => {
      const actionableArtifact: ProbeResultArtifact = {
        path: "probes/agent-local.md",
        projectScopeId: "project-1",
        probeScopeId: "agent-local",
        outcome: "partial",
        inferredStatus: "partial",
        confidenceScore: 0.5,
        evidenceRefs: [],
        sourcePaths: [],
        healthFindings:
          "- Bug: concurrency race in AgentLocalSessionWriter.\n- Recommended fix: add per-session serialization.",
      };

      const reviewArtifact: ProbeResultArtifact = {
        path: "probes/review-needed.md",
        projectScopeId: "project-1",
        probeScopeId: "review-needed",
        outcome: "partial",
        inferredStatus: "unknown",
        confidenceScore: 0.3,
        evidenceRefs: [],
        sourcePaths: [],
        healthFindings: "Pending human review for schema migration approach.",
      };

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [actionableArtifact, reviewArtifact],
      });

      expect(plan.counts.todo).toBeGreaterThan(0);
      expect(plan.counts.blocked).toBeGreaterThan(0);
      expect(plan.cycleDecision.decision).toBe("blocked");
      expect(plan.cycleDecision.readyForCycle).toBe(false);
    });
  });

  describe("human decision policy routing", () => {
    it("autonomous mode converts open questions to todo gap with autonomousDecision metadata", () => {
      const artifact = artifactWithOpenQuestions();
      const input: ImportedRepositoryBacklogReconcilerInput = {
        projectId: "project-1",
        artifacts: [artifact],
        orchestrationMode: "autonomous",
      };

      const plan = reconciler.reconcile(input);

      expect(plan.specs).toHaveLength(1);
      const spec = plan.specs[0];
      expect(spec.status).toBe("todo");
      expect(spec.workType).toBe("gap");
      expect(spec.metadata.originalWorkType).toBe("human_decision");
      expect(spec.metadata.autonomousDecision).toBe(true);
      expect(spec.metadata.feedbackNeeded).toBe(false);
      expect(spec.metadata.resolutionRationale).toBeDefined();
      expect(spec.metadata.lastGeneratedStatus).toBe("todo");
      expect(spec.metadata.generatedRecommendation).toBe("todo");
    });

    it("autonomous mode keeps cycleDecision repeat when open questions are the only findings", () => {
      const artifact = artifactWithOpenQuestions();

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
        orchestrationMode: "autonomous",
      });

      expect(plan.cycleDecision.decision).toBe("repeat");
      expect(plan.cycleDecision.readyForCycle).toBe(true);
      expect(plan.counts.blocked).toBe(0);
    });

    it("supervised mode converts open questions to blocked human_decision with decisionPrompt", () => {
      const artifact = artifactWithOpenQuestions();

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
        orchestrationMode: "supervised",
      });

      expect(plan.specs).toHaveLength(1);
      const spec = plan.specs[0];
      expect(spec.status).toBe("blocked");
      expect(spec.workType).toBe("human_decision");
      expect(spec.metadata.feedbackNeeded).toBe(true);
      expect(spec.metadata.autonomousDecision).toBe(false);
      expect(spec.metadata.decisionPrompt).toBeDefined();
      expect(spec.metadata.decisionPrompt).toContain("ETL");
      expect(spec.metadata.lastGeneratedStatus).toBe("blocked");
      expect(spec.metadata.generatedRecommendation).toBe("blocked");
    });

    it("supervised mode keeps cycleDecision blocked when open questions are the only findings", () => {
      const artifact = artifactWithOpenQuestions();

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
        orchestrationMode: "supervised",
      });

      expect(plan.cycleDecision.decision).toBe("blocked");
      expect(plan.cycleDecision.readyForCycle).toBe(false);
    });

    it("notifications_only mode converts open questions to todo gap", () => {
      const artifact = artifactWithOpenQuestions();

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
        orchestrationMode: "notifications_only",
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("todo");
      expect(plan.specs[0].workType).toBe("gap");
      expect(plan.specs[0].metadata.autonomousDecision).toBe(true);
      expect(plan.cycleDecision.decision).toBe("repeat");
    });

    it("preserves original openQuestion text in evidence metadata when routed through policy", () => {
      const artifact = artifactWithOpenQuestions();

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
        orchestrationMode: "autonomous",
      });

      expect(plan.specs[0].evidence.openQuestions).toContain("ETL");
      expect(plan.specs[0].evidence.openQuestions).toContain("downtime");
    });

    it("applies policy to health findings with human-decision phrases in autonomous mode", () => {
      const artifact: ProbeResultArtifact = {
        path: "probes/review-needed.md",
        projectScopeId: "project-1",
        probeScopeId: "review-needed",
        outcome: "partial",
        inferredStatus: "unknown",
        confidenceScore: 0.3,
        evidenceRefs: [],
        sourcePaths: [],
        healthFindings:
          "This requires product decision on data retention policy. Pending human review for schema migration.",
      };

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
        orchestrationMode: "autonomous",
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("todo");
      expect(plan.specs[0].workType).toBe("gap");
      expect(plan.specs[0].metadata.autonomousDecision).toBe(true);
      expect(plan.specs[0].metadata.originalWorkType).toBe("human_decision");
    });

    it("applies policy to health findings with human-decision phrases in supervised mode", () => {
      const artifact: ProbeResultArtifact = {
        path: "probes/review-needed.md",
        projectScopeId: "project-1",
        probeScopeId: "review-needed",
        outcome: "partial",
        inferredStatus: "unknown",
        confidenceScore: 0.3,
        evidenceRefs: [],
        sourcePaths: [],
        healthFindings:
          "This requires product decision on data retention policy.",
      };

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
        orchestrationMode: "supervised",
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("blocked");
      expect(plan.specs[0].workType).toBe("human_decision");
      expect(plan.specs[0].metadata.feedbackNeeded).toBe(true);
      expect(plan.specs[0].metadata.decisionPrompt).toBeDefined();
    });

    it("defaults to supervised when no orchestration mode is provided", () => {
      const artifact = artifactWithOpenQuestions();

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("blocked");
      expect(plan.specs[0].workType).toBe("human_decision");
      expect(plan.specs[0].metadata.feedbackNeeded).toBe(true);
    });

    it("respects explicit humanDecisionPolicy override over mode default", () => {
      const artifact = artifactWithOpenQuestions();

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
        orchestrationMode: "supervised",
        humanDecisionPolicy: "decide_without_approval",
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("todo");
      expect(plan.specs[0].workType).toBe("gap");
      expect(plan.specs[0].metadata.autonomousDecision).toBe(true);
    });

    it("preserves human-decision health findings status when no mode is available", () => {
      const artifact: ProbeResultArtifact = {
        path: "probes/hyphenated.md",
        projectScopeId: "project-1",
        probeScopeId: "hyphenated",
        outcome: "partial",
        inferredStatus: "unknown",
        confidenceScore: 0.3,
        evidenceRefs: [],
        sourcePaths: [],
        healthFindings:
          "This requires-product-decision on the data retention policy before proceeding.",
      };

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
      });

      expect(plan.specs).toHaveLength(1);
      expect(plan.specs[0].status).toBe("blocked");
      expect(plan.specs[0].workType).toBe("human_decision");
    });
  });

  describe("autonomous rerun sourceId stability and metadata preservation", () => {
    it("produces the same sourceId for supervised and autonomous modes on the same human-decision artifact", () => {
      const artifact = artifactWithOpenQuestions();

      const supervised = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
        orchestrationMode: "supervised",
      });

      const autonomous = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
        orchestrationMode: "autonomous",
      });

      expect(supervised.specs[0].sourceId).toBe(autonomous.specs[0].sourceId);
    });

    it("keeps :human_decision: in sourceId when autonomous policy resolves workType to gap", () => {
      const artifact = artifactWithOpenQuestions();

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
        orchestrationMode: "autonomous",
      });

      expect(plan.specs[0].sourceId).toContain(":human_decision:");
      expect(plan.specs[0].workType).toBe("gap");
    });

    it("preserves originalWorkType, sourceHash, and finding evidence in autonomous rerun metadata", () => {
      const artifact = artifactWithOpenQuestions();

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
        orchestrationMode: "autonomous",
      });

      const spec = plan.specs[0];
      expect(spec.metadata.originalWorkType).toBe("human_decision");
      expect(spec.metadata.sourceHash).toBeDefined();
      expect(spec.evidence.openQuestions).toContain("ETL");
      expect(spec.metadata.autonomousDecision).toBe(true);
      expect(spec.metadata.lastGeneratedStatus).toBe("todo");
      expect(spec.metadata.generatedRecommendation).toBe("todo");
      expect(spec.metadata.policy).toBe("decide_without_approval");
    });

    it("preserves originalWorkType for health findings with human-decision phrases in autonomous mode", () => {
      const artifact: ProbeResultArtifact = {
        path: "probes/review-needed.md",
        projectScopeId: "project-1",
        probeScopeId: "review-needed",
        outcome: "partial",
        inferredStatus: "unknown",
        confidenceScore: 0.3,
        evidenceRefs: [],
        sourcePaths: [],
        healthFindings:
          "This requires product decision on data retention policy. Pending human review for schema migration.",
      };

      const plan = reconciler.reconcile({
        projectId: "project-1",
        artifacts: [artifact],
        orchestrationMode: "autonomous",
      });

      expect(plan.specs[0].sourceId).toContain(":human_decision:");
      expect(plan.specs[0].workType).toBe("gap");
      expect(plan.specs[0].metadata.originalWorkType).toBe("human_decision");
      expect(plan.specs[0].evidence.healthFindings).toContain(
        "product decision",
      );
    });
  });
});
