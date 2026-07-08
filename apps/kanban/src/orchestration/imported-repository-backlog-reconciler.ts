import { createHash } from "node:crypto";
import { HumanDecisionResolutionPolicyService } from "./human-decision-resolution-policy.service";
import type { ProbeResultArtifact } from "./probe-result-artifact.types";
import type {
  ImportedRepositoryBacklogReconciliationPlan,
  ImportedRepositoryBacklogReconcilerInput,
  OrchestrationCycleDecision,
  RepositoryWorkItemSpec,
  WorkItemStatus,
  WorkType,
} from "./imported-repository-backlog-reconciler.types";
export type {
  ImportedRepositoryBacklogReconciliationPlan,
  ImportedRepositoryBacklogReconcilerInput,
  OrchestrationCycleDecision,
  RepositoryWorkItemSpec,
} from "./imported-repository-backlog-reconciler.types";

const HIGH_CONFIDENCE_THRESHOLD = 0.8;

function normalizeScopeId(scope: string | undefined): string {
  if (!scope) return "unknown";
  return scope
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function computeSourceHash(inputs: Record<string, unknown>): string {
  const payload = JSON.stringify(inputs);
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function buildSourceId(
  projectId: string,
  workType: WorkType,
  scope: string,
): string {
  const normalized = normalizeScopeId(scope);
  return `imported-repo:${projectId}:${workType}:${normalized}`;
}

function includesAnyNormalized(
  text: string,
  phrases: readonly string[],
): boolean {
  return phrases.some((phrase) => {
    const normalized = phrase.replace(/\s+/g, "-").toLowerCase();
    return text.includes(phrase.toLowerCase()) || text.includes(normalized);
  });
}

function classifyHealthFindings(text: string): {
  status: WorkItemStatus;
  workType: WorkType;
  reason: string;
} {
  const humanDecisionPhrases = [
    "requires product decision",
    "pending human review",
    "needs owner input",
    "human decision",
  ];

  const lower = text.toLowerCase();
  if (includesAnyNormalized(lower, humanDecisionPhrases)) {
    return {
      status: "blocked",
      workType: "human_decision",
      reason: text,
    };
  }

  return {
    status: "todo",
    workType: "gap",
    reason: text,
  };
}

function isImplementedWithHighConfidence(
  artifact: ProbeResultArtifact,
): boolean {
  const isHighConfidence =
    artifact.confidenceScore !== undefined &&
    artifact.confidenceScore >= HIGH_CONFIDENCE_THRESHOLD;
  const isImplementedOrSuccess =
    artifact.inferredStatus === "implemented" ||
    artifact.inferredStatus === "success" ||
    artifact.outcome === "success";
  return isImplementedOrSuccess && isHighConfidence;
}

function classifyArtifact(artifact: ProbeResultArtifact): {
  status: WorkItemStatus;
  workType: WorkType;
  reason: string;
} | null {
  const hasOpenQuestions =
    artifact.openQuestions !== undefined &&
    artifact.openQuestions.trim().length > 0;
  const openQuestionsText = artifact.openQuestions ?? "";

  if (hasOpenQuestions) {
    return {
      status: "blocked",
      workType: "human_decision",
      reason: openQuestionsText,
    };
  }

  const hasHealthFindings =
    artifact.healthFindings !== undefined &&
    artifact.healthFindings.trim().length > 0;
  const healthFindingsText = artifact.healthFindings ?? "";

  if (hasHealthFindings) {
    return classifyHealthFindings(healthFindingsText);
  }

  if (isImplementedWithHighConfidence(artifact)) {
    return {
      status: "done",
      workType: "existing_capability",
      reason:
        artifact.narrativeSummary ?? "Capability exists with high confidence.",
    };
  }

  return null;
}

export class ImportedRepositoryBacklogReconciler {
  reconcile(
    input: ImportedRepositoryBacklogReconcilerInput,
  ): ImportedRepositoryBacklogReconciliationPlan {
    const { projectId, artifacts, orchestrationMode, humanDecisionPolicy } =
      input;
    const policyService = new HumanDecisionResolutionPolicyService();
    const specs: RepositoryWorkItemSpec[] = [];
    const findings: RepositoryWorkItemSpec[] = [];
    const openQuestions: string[] = [];

    for (const artifact of artifacts) {
      const classification = classifyArtifact(artifact);
      if (!classification) continue;

      const scopeId = artifact.probeScopeId ?? artifact.path;
      const sourceId = buildSourceId(
        projectId,
        classification.workType,
        scopeId,
      );
      const sourceHash = computeSourceHash({
        projectId,
        path: artifact.path,
        projectScopeId: artifact.projectScopeId,
        probeScopeId: artifact.probeScopeId,
        outcome: artifact.outcome,
        inferredStatus: artifact.inferredStatus,
        confidenceScore: artifact.confidenceScore,
        evidenceRefs: artifact.evidenceRefs,
        sourcePaths: artifact.sourcePaths,
        narrativeSummary: artifact.narrativeSummary,
        capabilityUpdates: artifact.capabilityUpdates,
        healthFindings: artifact.healthFindings,
        openQuestions: artifact.openQuestions,
      });

      if (artifact.openQuestions) {
        openQuestions.push(artifact.openQuestions);
      }

      let status = classification.status;
      let workType = classification.workType;
      const specMetadata: { sourceHash: string } & Record<string, unknown> = {
        sourceHash,
      };

      if (classification.workType === "human_decision") {
        const findingText =
          artifact.openQuestions ?? artifact.healthFindings ?? "";
        const resolution = policyService.resolve({
          orchestrationMode: orchestrationMode ?? "supervised",
          configuredPolicy: humanDecisionPolicy,
          findingText,
        });

        status = resolution.status;
        workType = resolution.workType;
        Object.assign(specMetadata, {
          originalWorkType: classification.workType,
          ...resolution,
        });
      }

      const spec: RepositoryWorkItemSpec = {
        sourceId,
        status,
        workType,
        title: scopeId,
        reason: classification.reason,
        evidence: {
          artifactPath: artifact.path,
          probeScopeId: artifact.probeScopeId,
          evidenceRefs: artifact.evidenceRefs,
          sourcePaths: artifact.sourcePaths,
          confidenceScore: artifact.confidenceScore,
          projectScopeId: artifact.projectScopeId,
          outcome: artifact.outcome,
          inferredStatus: artifact.inferredStatus,
          narrativeSummary: artifact.narrativeSummary,
          capabilityUpdates: artifact.capabilityUpdates,
          healthFindings: artifact.healthFindings,
          openQuestions: artifact.openQuestions,
        },
        metadata: specMetadata,
      };

      specs.push(spec);
      findings.push(spec);
    }

    const counts = {
      total: specs.length,
      done: specs.filter((s) => s.status === "done").length,
      todo: specs.filter((s) => s.status === "todo").length,
      blocked: specs.filter((s) => s.status === "blocked").length,
    };

    const cycleDecision = resolveCycleDecision(counts);

    return {
      specs,
      findings,
      counts,
      summary: `Reconciled ${counts.total} specs: ${counts.done} done, ${counts.todo} todo, ${counts.blocked} blocked`,
      diagnostics: {
        artifactCount: artifacts.length,
        mappedSpecs: specs.length,
        mappedFindings: findings.length,
      },
      cycleDecision,
      openQuestions,
    };
  }
}

function resolveCycleDecision(
  counts: ImportedRepositoryBacklogReconciliationPlan["counts"],
): OrchestrationCycleDecision {
  if (counts.blocked > 0) {
    return {
      decision: "blocked",
      reason: `${counts.blocked} spec(s) require human decision`,
      readyForCycle: false,
    };
  }

  if (counts.todo > 0) {
    return {
      decision: "repeat",
      reason: `${counts.todo} spec(s) remain for implementation`,
      readyForCycle: true,
    };
  }

  return {
    decision: "complete",
    reason: "All specs resolved",
    readyForCycle: true,
  };
}
